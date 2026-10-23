import { compact } from "@foreverworks/mcp-kit";

import { fail, inputError } from "./errors.js";
import type { InvoiceFacts, InvoiceReading } from "./invoiceXml.js";
import type { ValidationAnswer } from "./schema.js";

/**
 * ANAF's names for the two documents /validare and /transformare take: a UBL
 * Invoice is FACT1, a UBL CreditNote is FCN. Neither takes CII, although
 * /upload does.
 */
export type ValidationStandard = "FACT1" | "FCN";

/** Both endpoints refuse a document over 5 MB ("Marime fisier transmis mai mare de 5 MB", validare.html). */
export const MAX_VALIDATION_BYTES = 5 * 1024 * 1024;

/**
 * Which standard a document is, read from the document itself rather than
 * asked of the caller: a caller who says FACT1 for a credit note gets a SAX
 * error about the root element from ANAF, which explains nothing. The facts
 * come back with it, for the result to say which invoice it was about.
 */
export const validationTarget = (reading: InvoiceReading): { readonly standard: ValidationStandard; readonly facts: InvoiceFacts } => {
  if (reading.kind === "unreadable") return fail(inputError(`the XML cannot be read as an invoice: ${reading.why}`));
  if (reading.facts.syntax !== "UBL")
    return fail(inputError("ANAF validates and converts UBL only (Invoice or CreditNote); this document is CII"));
  return { standard: reading.facts.document === "credit note" ? "FCN" : "FACT1", facts: reading.facts };
};

/** One thing ANAF found wrong: the rule it broke and where, when ANAF says so. */
export type Finding = { readonly rule?: string; readonly location?: string; readonly text: string };

/**
 * ANAF writes its findings as prose in these shapes, all seen on 2026-09-30
 * (the first three live, the last in validare.html's own examples):
 *
 * - a Schematron rule, as `key=value` pairs, the text last:
 *   `tipAssert=FailedAssert; codEroare=BR-RO-001; localizareEroare=/Invoice; textEroare=[BR-RO-001]-...`
 * - ANAF's own checks, the same pairs without a location:
 *   `tipAssert=E; codEroare=ERRIdentif; textEroare=CUI cumparator incorect`
 * - a schema error from the XML parser:
 *   `Fisierul transmis nu este valid. org.xml.sax.SAXParseException; lineNumber: 14; columnNumber: 239; cvc-elt.1.a: ...`
 * - the older Schematron form: `E: validari globale  SCHEMATRON   eroare: [BR-CO-09]-...`
 *
 * Anything else is kept whole as `text`. The rule id is also stripped from the
 * front of the text, where ANAF repeats it.
 */
const SAX = /^(.*?)\s*org\.xml\.sax\.SAXParseException;\s*lineNumber:\s*(\d+);\s*columnNumber:\s*(\d+);\s*([\s\S]*)$/;
const RULE_PREFIX = /^\s*\[([A-Za-z0-9_.-]+)\]\s*-\s*/;
const LEGACY_RULE = /\[([A-Za-z0-9_.-]+)\]\s*-\s*([\s\S]*)$/;

const withoutRule = (text: string): string => text.replace(RULE_PREFIX, "").trim();

/** One `key=value` of the pairs before `textEroare`, which is last and may itself hold a `;`. */
const pairOf = (head: string, key: string): string | undefined => {
  const value = new RegExp(`(?:^|;)\\s*${key}=([^;]*)`).exec(head)?.[1]?.trim();
  return value === undefined || value === "" ? undefined : value;
};

export const findingOf = (message: string): Finding => {
  if (message.startsWith("tipAssert=")) {
    const at = message.indexOf("textEroare=");
    const head = at < 0 ? message : message.slice(0, at);
    const text = at < 0 ? message : message.slice(at + "textEroare=".length);
    return compact({ rule: pairOf(head, "codEroare"), location: pairOf(head, "localizareEroare"), text: withoutRule(text) });
  }
  const sax = SAX.exec(message);
  if (sax) {
    const [, lead = "", line = "", column = "", text = ""] = sax;
    return { location: `line ${line}, column ${column}`, text: [lead, text.trim()].filter((part) => part !== "").join(" ") };
  }
  const legacy = LEGACY_RULE.exec(message);
  if (legacy) {
    const [, code = "", text = ""] = legacy;
    return { rule: code, text: text.trim() };
  }
  return { text: message.trim() };
};

export type Verdict = {
  readonly valid: boolean;
  readonly findings: readonly Finding[];
  /** ANAF's id for this check, which its support asks for. */
  readonly traceId: string;
};

/** `stare: ok` is the only pass; anything else, including a value ANAF has not documented, is not one. */
export const verdictOf = (answer: ValidationAnswer): Verdict => ({
  valid: answer.stare === "ok",
  findings: (answer.Messages ?? []).flatMap((m) => (m.message === undefined || m.message.trim() === "" ? [] : [findingOf(m.message)])),
  traceId: answer.trace_id,
});

/** What /transformare answers when it converts: the PDF itself, not JSON. */
export const looksLikePdf = (bytes: Buffer): boolean => bytes.subarray(0, 5).toString("latin1") === "%PDF-";

/**
 * The file a PDF is saved under: the message id for a filed invoice, else the
 * invoice's own number. Both come from outside (ANAF, or the document), so
 * anything but a safe filename character goes, as for archives.
 */
export const pdfName = (base: string): string => {
  const safe = base.replace(/[^A-Za-z0-9_-]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  if (safe === "") return fail(inputError(`"${base}" has no usable characters for a filename`));
  return `${safe}.pdf`;
};
