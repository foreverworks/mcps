/**
 * ocrmypdf's --sidecar file: tesseract's own text for the pages it OCRed, one
 * entry per page separated by form feeds. Pages it skipped because they had
 * text are one placeholder per RUN of pages ("[OCR skipped on page(s) 1-2]"),
 * so entries cannot be matched to pages by position alone.
 *
 * Why the sidecar and not pdftotext of the OCRed PDF: measured 2026-10-29 on a
 * Romanian page, pdftotext read the invisible text layer with the space before
 * every word starting with "î" missing ("Chiriașulîși"), three runs in three;
 * the sidecar had every line exact.
 */
const SKIPPED = /^\[OCR skipped on page\(s\) (\d+)(?:-(\d+))?\]$/u;

/** Page number (from 1) -> the text tesseract read on it, for the pages it OCRed. */
export const sidecarPages = (sidecar: string): ReadonlyMap<number, string> => {
  const pages = new Map<number, string>();
  let page = 1;
  for (const entry of sidecar.split("\f")) {
    const skipped = SKIPPED.exec(entry.trim());
    if (skipped !== null) {
      page = Number(skipped[2] ?? skipped[1]) + 1;
      continue;
    }
    if (entry.trim().length > 0) pages.set(page, entry);
    page += 1;
  }
  return pages;
};
