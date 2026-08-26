"use client";

/**
 * Turns an uploaded PDF or image into page bitmaps, entirely in the browser.
 * Rendering client-side keeps the payload predictable and lets us show real
 * per-page progress while the file is being prepared.
 */

const TARGET_WIDTH = 1400; // enough detail for handwriting OCR without bloating the request
const JPEG_QUALITY = 0.82;

let pdfjsPromise = null;

async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((lib) => {
      // Served from public/ by scripts/copy-pdf-worker.mjs (runs before dev/build).
      lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return lib;
    });
  }
  return pdfjsPromise;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)}KB`;
  return `${(kb / 1024).toFixed(kb / 1024 >= 10 ? 0 : 1)}MB`;
}

function canvasToPage(canvas) {
  return {
    dataUrl: canvas.toDataURL("image/jpeg", JPEG_QUALITY),
    width: canvas.width,
    height: canvas.height,
  };
}

async function renderPdf(file, onProgress) {
  const pdfjs = await getPdfjs();
  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buffer }).promise;
  const pages = [];

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: TARGET_WIDTH / base.width });

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: context, viewport }).promise;
    pages.push(canvasToPage(canvas));
    onProgress?.(n, doc.numPages);
  }

  await doc.destroy();
  return pages;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function renderImage(file, onProgress) {
  const dataUrl = await readAsDataUrl(file);
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error(`Could not decode ${file.name}`));
    el.src = dataUrl;
  });

  const scale = Math.min(1, TARGET_WIDTH / img.naturalWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(img, 0, 0, canvas.width, canvas.height);

  onProgress?.(1, 1);
  return [canvasToPage(canvas)];
}

/**
 * Accepts one or more files (a multi-image upload counts as consecutive pages)
 * and returns a flat, ordered page list.
 */
export async function filesToPages(fileList, onProgress) {
  const files = Array.from(fileList);
  const pages = [];

  for (const file of files) {
    const isPdf =
      file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    const rendered = isPdf
      ? await renderPdf(file, onProgress)
      : await renderImage(file, onProgress);
    pages.push(...rendered);
  }

  if (pages.length === 0) throw new Error("No readable pages found in that upload.");
  return pages;
}

export function describeUpload(fileList, pageCount) {
  const files = Array.from(fileList);
  const bytes = files.reduce((sum, f) => sum + f.size, 0);
  const name =
    files.length === 1 ? files[0].name : `${files.length} files`;
  return {
    name,
    size: formatBytes(bytes),
    pages: pageCount,
    isPdf: files.length === 1 && /\.pdf$/i.test(files[0].name),
  };
}
