import { sha256Of } from "@foreverworks/mcp-kit";

/**
 * The idempotency key a document is sent with when the caller gives none:
 * derived from what the document IS (its kind, the company, its whole content
 * and the day it is issued on), so an identical retry after a lost answer
 * carries the same key and Oblio refuses to issue it twice. A random key per
 * call would make every retry a new invoice. Issuing a second, deliberately
 * identical document on the same day needs a key of the caller's own.
 */
export type KeyedKind = "invoice" | "proforma" | "invoice-from-proforma" | "collect" | "reversal";

/** JSON with object keys sorted, so one value has one text. */
export const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

/** `day` is YYYY-MM-DD: the document's issue date, or the day it is sent when it names none. */
export const contentKey = (kind: KeyedKind, cif: string, content: object, day: string): string =>
  `mcp-oblio-${sha256Of(Buffer.from(canonical({ kind, cif, content, day }), "utf8")).slice(0, 40)}`;
