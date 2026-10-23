import { fail, inputError } from "./errors.js";

/**
 * A downloaded archive is named after the message id, and the message id comes
 * from an ANAF response rather than from us. Stripping separators keeps a
 * malformed or hostile id from writing outside the directory the caller chose.
 */
export const archiveName = (messageId: string): string => {
  const safe = messageId.replace(/[^A-Za-z0-9_-]/g, "");
  if (safe === "") fail(inputError(`"${messageId}" has no usable characters for a filename`));
  return `${safe}.zip`;
};

/**
 * The n-th name to try for a file when `name` is taken by different bytes:
 * `5001.pdf`, then `5001-2.pdf`, `5001-3.pdf`. A saved file is never replaced
 * by another one under the same name (two invoices numbered alike by two
 * suppliers, an archive downloaded again after ANAF re-sealed it).
 */
export const numberedName = (name: string, n: number): string => {
  if (n <= 1) return name;
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? `${name}-${n}` : `${name.slice(0, dot)}-${n}${name.slice(dot)}`;
};

/**
 * ANAF answers `/descarcare` with a ZIP, and answers an unknown id with a 200
 * carrying a JSON refusal (its own published examples). Without this check that
 * refusal lands on disk named like an invoice and is only discovered when
 * something tries to open it.
 */
export const looksLikeZip = (bytes: Buffer): boolean =>
  bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
