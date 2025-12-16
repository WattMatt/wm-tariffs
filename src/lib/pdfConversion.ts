/**
 * PDF to Image Conversion Utility
 * Converts PDF files/URLs to high-quality PNG images using PDF.js
 */

export interface PdfConversionOptions {
  scale?: number; // Default 2.0 for high quality
  pageNumber?: number; // Default 1 (first page)
  format?: 'png' | 'jpeg';
  quality?: number; // 0-1 for JPEG
}

export interface PdfConversionResult {
  blob: Blob;
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * Initialize PDF.js with the worker
 */
async function initPdfJs() {
  const pdfjsLib = await import('pdfjs-dist');
  
  // Set worker using Vite-compatible approach
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString();
  
  return pdfjsLib;
}

/**
 * Convert a PDF file (from File object) to an image
 */
export async function convertPdfFileToImage(
  file: File,
  options: PdfConversionOptions = {}
): Promise<PdfConversionResult> {
  const { scale = 2.0, pageNumber = 1, format = 'png', quality = 1.0 } = options;
  
  const pdfjsLib = await initPdfJs();
  
  // Load PDF from file
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  
  return renderPdfPageToImage(pdf, { scale, pageNumber, format, quality });
}

/**
 * Convert a PDF from URL to an image
 */
export async function convertPdfUrlToImage(
  url: string,
  options: PdfConversionOptions = {}
): Promise<PdfConversionResult> {
  const { scale = 2.0, pageNumber = 1, format = 'png', quality = 1.0 } = options;
  
  const pdfjsLib = await initPdfJs();
  
  // Load PDF from URL
  const pdf = await pdfjsLib.getDocument(url).promise;
  
  return renderPdfPageToImage(pdf, { scale, pageNumber, format, quality });
}

/**
 * Core rendering function - converts a PDF page to canvas then to image
 */
async function renderPdfPageToImage(
  pdf: any,
  options: Required<PdfConversionOptions>
): Promise<PdfConversionResult> {
  const { scale, pageNumber, format, quality } = options;
  
  // Get the specified page
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  
  // Create canvas
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  
  if (!context) {
    throw new Error('Could not get canvas context');
  }
  
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  
  // Render PDF page to canvas
  await page.render({
    canvasContext: context,
    viewport: viewport,
  }).promise;
  
  // Convert canvas to blob and data URL
  const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to convert canvas to blob'));
        }
      },
      mimeType,
      quality
    );
  });
  
  const dataUrl = canvas.toDataURL(mimeType, quality);
  
  return {
    blob,
    dataUrl,
    width: viewport.width,
    height: viewport.height,
  };
}
