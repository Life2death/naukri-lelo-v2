import mammoth from "mammoth";
import * as pdfjsLib from "pdfjs-dist";

// Point the worker at the bundled worker file so Vite can serve it
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).href;

/**
 * Extracts plain text from a PDF file using pdfjs-dist.
 * Handles compressed streams, CIDFont encodings, and all modern PDF variants.
 */
async function extractTextFromPDF(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();

  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;

  const pageTexts: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    // Join text items; use a space between items and a newline between lines
    const pageText = content.items
      .map((item: any) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (pageText) {
      pageTexts.push(pageText);
    }
  }

  const text = pageTexts.join("\n\n");
  return (
    text ||
    "[Could not extract text from this PDF. The file may be image-based or scanned. Try copying and pasting the text manually.]"
  );
}

/**
 * Extracts plain text from a DOCX file using mammoth.
 */
async function extractTextFromDOCX(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value.trim() || "[Could not extract text from this document.]";
}

/**
 * Extracts plain text from a PDF or DOCX/DOC file.
 * Returns the extracted text string.
 */
export async function extractTextFromFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) {
    return extractTextFromPDF(file);
  }
  if (name.endsWith(".docx") || name.endsWith(".doc")) {
    return extractTextFromDOCX(file);
  }
  throw new Error(
    "Unsupported file type. Please upload a PDF or Word document (.pdf, .doc, .docx)."
  );
}
