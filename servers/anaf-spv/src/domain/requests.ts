import { fail, inputError } from "./errors.js";
import { folded } from "./messages.js";

/**
 * Which fields a document request ("Solicitări") takes, per type. Pure.
 *
 * The rules are SPV's own form script (`verificare5.js`):
 * selecting a type enables, disables or fixes the year, the month, the
 * registration number and the PUI. A disabled field is not sent at all (the
 * portal fills it, e.g. month 12 for a duplicate of the annual return), a
 * read-only one is sent empty. Which types an identity may request is the
 * portal's live list (list_document_types), never this table: a type missing
 * here is sent with whatever the caller gave, and SPV decides.
 */
export type RequestField = "year" | "month" | "registration_number" | "pui" | "month_range";

export type TypeRule = {
  /** Fields the request must carry. */
  readonly requires: readonly RequestField[];
  /** Fields it may carry. */
  readonly accepts: readonly RequestField[];
  /** A month the portal sets itself (12 for annual documents, 6 for the half-year balance sheet). */
  readonly fixedMonth?: number;
  readonly note?: string;
};

const NOTHING: TypeRule = { requires: [], accepts: [] };
const ANNUAL: TypeRule = { requires: ["year"], accepts: ["year"], fixedMonth: 12 };

const RULES: ReadonlyArray<readonly [readonly string[], TypeRule]> = [
  [
    [
      "Obligatii de plata",
      "Nota obligatiilor de plata",
      "Istoric declaratii PF",
      "Istoric Spatiu Virtual",
      "Venituri Formular Banca",
      "D112Contrib",
      "C168",
      "Istoric bilant",
      "DATE IDENTIFICARE",
      "VECTOR FISCAL",
      "Situatie Sintetica",
      "Reprezentanti SPV",
      "Registru intrari-iesiri",
      "InterogariBanci",
      "Detalii neconcordante D112 REVISAL",
    ],
    NOTHING,
  ],
  [["Duplicat declaratie unica"], { ...ANNUAL, note: "year is the REPORTING year: 2025 returns the return filed in 2025, about 2024's income" }],
  [["Bilant anual", "Istoric declaratii", "D205", "D101", "D120", "D130", "D392", "D393", "D106"], ANNUAL],
  [["Bilant semestrial"], { requires: ["year"], accepts: ["year"], fixedMonth: 6 }],
  [["Duplicat Recipisa"], { requires: ["registration_number"], accepts: ["registration_number"], note: "registration_number is the filing's number, e.g. INTERNT-123456789-2026" }],
  [["Fisa Rol Simplificata", "Fisa Rol Completa", "Rezumat Fisa Rol cu XLS atasat"], { requires: [], accepts: ["pui"] }],
  [["Neconcordante D394"], { requires: ["year"], accepts: ["year", "month_range"] }],
];

/** Any other type: the form leaves the year and the month open, and SPV says what it needs. */
const OPEN: TypeRule = { requires: [], accepts: ["year", "month"] };

export const ruleFor = (type: string): TypeRule => RULES.find(([names]) => names.some((n) => folded(n) === folded(type)))?.[1] ?? OPEN;

export type RequestArgs = {
  readonly year?: number | undefined;
  readonly month?: number | undefined;
  readonly registrationNumber?: string | undefined;
  readonly pui?: string | undefined;
  readonly monthFrom?: number | undefined;
  readonly monthTo?: number | undefined;
};

/** What the form will be sent with: every field as text, empty where the type takes nothing. */
export type RequestFields = {
  readonly year: string;
  /** `undefined`: the field is disabled for this type and must not be sent. */
  readonly month: string | undefined;
  readonly registrationNumber: string;
  readonly pui: string;
  readonly monthFrom: string | undefined;
  readonly monthTo: string | undefined;
};

const given = (args: RequestArgs): readonly RequestField[] => [
  ...(args.year !== undefined ? (["year"] as const) : []),
  ...(args.month !== undefined ? (["month"] as const) : []),
  ...(args.registrationNumber !== undefined ? (["registration_number"] as const) : []),
  ...(args.pui !== undefined ? (["pui"] as const) : []),
  ...(args.monthFrom !== undefined || args.monthTo !== undefined ? (["month_range"] as const) : []),
];

/**
 * The fields to send for `type`, or an input failure naming what is missing
 * or not taken. Nothing is sent to SPV until this has passed.
 */
export const fieldsFor = (type: string, args: RequestArgs): RequestFields => {
  const rule = ruleFor(type);
  const missing = rule.requires.filter((f) => !given(args).includes(f));
  if (missing.length > 0) fail(inputError(`"${type}" needs ${missing.join(", ")}${rule.note ? ` (${rule.note})` : ""}`));
  const extra = given(args).filter((f) => !rule.accepts.includes(f));
  if (extra.length > 0) fail(inputError(`"${type}" takes ${rule.accepts.length > 0 ? `only ${rule.accepts.join(", ")}` : "no fields"}; drop ${extra.join(", ")}`));
  const range = rule.accepts.includes("month_range");
  return {
    year: args.year === undefined ? "" : String(args.year),
    month: rule.fixedMonth !== undefined || range || !rule.accepts.includes("month") ? undefined : args.month === undefined ? "" : String(args.month),
    registrationNumber: args.registrationNumber?.trim() ?? "",
    pui: args.pui?.trim() ?? "",
    monthFrom: range ? String(args.monthFrom ?? 1) : undefined,
    monthTo: range ? String(args.monthTo ?? 12) : undefined,
  };
};

/** A type as list_document_types shows it. */
export const typeView = (type: string) => {
  const rule = ruleFor(type);
  return {
    type,
    requires: rule.requires,
    accepts: rule.accepts,
    ...(rule.fixedMonth === undefined ? {} : { month_set_by_spv: rule.fixedMonth }),
    ...(rule.note === undefined ? {} : { note: rule.note }),
  };
};

/**
 * Types SPV generates only for a company (a CUI), although its form offers
 * them to a person as well: a request for a CNP is refused, "Notificare"
 * with "Raportul Notificare se genereaza doar pentru un CUI". Others
 * are learned from such a refusal and remembered (cui-only.json), never by
 * probing: some requests make real documents.
 */
export const KNOWN_CUI_ONLY: readonly string[] = ["Notificare"];

/** SPV's words for "this report is only for a company". */
export const saysCuiOnly = (message: string): boolean => /se genereaza doar pentru (un )?cui\b/.test(folded(message));

/** A type held back from a person's list, and why. */
export type CuiOnly = { readonly type: string; readonly source: "known" } | { readonly type: string; readonly source: "learned"; readonly learnedAtMs: number; readonly spvSaid: string };

/** The CUI-only types among `offered`, known first, then learned. */
export const cuiOnlyAmong = (offered: readonly string[], learned: Readonly<Record<string, CuiOnly>>): readonly CuiOnly[] =>
  offered.flatMap((type): CuiOnly[] => {
    if (KNOWN_CUI_ONLY.some((k) => folded(k) === folded(type))) return [{ type, source: "known" }];
    const l = learned[folded(type)];
    return l === undefined ? [] : [{ ...l, type }];
  });
