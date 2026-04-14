import mammoth from "mammoth";

/**
 * Extracts plain text from a PDF file using BT/ET text block parsing.
 * Pure JS — no pdfjs-dist dependency needed.
 */
async function extractTextFromPDF(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Convert binary to Latin-1 string for regex matching
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  const textParts: string[] = [];

  // Find all BT...ET blocks (text blocks in PDF)
  const btEtRegex = /BT([\s\S]*?)ET/g;
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = btEtRegex.exec(binary)) !== null) {
    const block = blockMatch[1];

    // Extract text from Tj operators: (text) Tj
    const tjRegex = /\(([^)]*)\)\s*Tj/g;
    let m: RegExpExecArray | null;
    while ((m = tjRegex.exec(block)) !== null) {
      textParts.push(decodePdfString(m[1]));
    }

    // Extract text from TJ operators: [(text) spacing (text)] TJ
    const tjArrayRegex = /\[(.*?)\]\s*TJ/g;
    while ((m = tjArrayRegex.exec(block)) !== null) {
      const inner = m[1];
      const innerTj = /\(([^)]*)\)/g;
      let im: RegExpExecArray | null;
      while ((im = innerTj.exec(inner)) !== null) {
        textParts.push(decodePdfString(im[1]));
      }
    }
  }

  const text = textParts.join(" ").replace(/\s+/g, " ").trim();
  return text || "[Could not extract text from this PDF. Try copying and pasting the text manually.]";
}

/**
 * Decodes common PDF string escape sequences.
 */
function decodePdfString(s: string): string {
  return s
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\")
    .replace(/\\'/g, "'")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/[^\x20-\x7E\n\r\t]/g, ""); // Strip non-printable chars
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
  throw new Error("Unsupported file type. Please upload a PDF or Word document (.pdf, .doc, .docx).");
}
