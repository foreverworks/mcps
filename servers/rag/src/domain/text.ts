/**
 * Text as it comes out of an extractor, made comparable: one Unicode form, one
 * line ending, no invisible characters, and for Romanian the comma-below
 * letters a reader types today.
 */

/** Romanian is written with ș and ț (comma below); OCR and older documents give the cedilla forms. */
const ROMANIAN_COMMA_BELOW: Readonly<Record<string, string>> = { "ş": "ș", "Ş": "Ș", "ţ": "ț", "Ţ": "Ț" };

/**
 * Whether a language setting (tesseract's codes, `ron+eng`) includes Romanian.
 * The cedilla letters are correct in Turkish, so they are only rewritten for a
 * document read as Romanian.
 */
export const includesRomanian = (language: string): boolean => language.split("+").some((code) => code.trim() === "ron");

/**
 * Control characters other than tab and newline: a form feed or vertical tab
 * becomes a line break, the rest go. Postgres refuses NUL in text outright,
 * and one NUL in a file failed the database write for the whole call.
 */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;

export const normaliseText = (text: string, language: string): string => {
  let out = text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL, (c) => (c === "\u000B" || c === "\u000C" ? "\n" : ""))
    .replace(/\u00A0/g, " ")
    .replace(/[\u00AD\u200B\uFEFF]/g, "");
  if (includesRomanian(language)) out = out.replace(/[şŞţŢ]/g, (c) => ROMANIAN_COMMA_BELOW[c] ?? c);
  return out
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, "").replace(/[ \t]{2,}/g, " "))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

/** Characters that are not white space: what decides whether a PDF page has a text layer worth keeping. */
export const visibleLength = (text: string): number => text.replace(/\s+/g, "").length;
