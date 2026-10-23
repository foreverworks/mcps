import { readD100 } from "./declarations/d100.js";
import { readD112 } from "./declarations/d112.js";
import { readD212 } from "./declarations/d212.js";
import { readD300, vatText } from "./declarations/d300.js";
import { KITS, type KitSource } from "./declarations/kits.js";
import { obligationsText, type Payable, type Reading, shortName } from "./declarations/reading.js";
import { elementsOf, type XmlElement } from "./declarations/xml.js";
import { fail, inputError } from "./errors.js";

/**
 * The declarations this server validates with ANAF's own DUKIntegrator and
 * turns into the filing PDF, and how each is filed. Pure.
 *
 * Where a form is filed decides what submit_declaration can do with it
 * (read 2026-10-22, static.anaf.ro .../Declaratii_R/descarcare_declaratii.htm):
 * - formularespv-pf.anaf.ro ("Depunere declaratie unica si alte formulare
 *   SPV-PF") takes a person's D212 from an SPV account with a user name and
 *   password, this server's kind;
 * - D100, D300 and D112 go only through e-guvernare.ro (decl.anaf.mfinante.gov.ro),
 *   as a PDF signed with a qualified certificate, which this server does not
 *   hold. They are validated and made into that PDF here, and filed elsewhere.
 */

export type Filing = { readonly via: "formularespv-pf"; readonly uploadPath: string } | { readonly via: "e-guvernare" };

export type FormSpec = {
  /** The XML's root element. */
  readonly root: string;
  readonly title: string;
  readonly filing: Filing;
  /** ANAF's packages for it (declarations/kits.ts). */
  readonly kits: readonly KitSource[];
  readonly read: (root: XmlElement, elements: readonly XmlElement[]) => Reading;
  /** What the confirmation line says it makes payable. */
  readonly payableText?: (payable: Payable) => string;
  /** How a filed one is put right, for the confirmation line. */
  readonly correction?: string;
};

export const FORMS = {
  D212: {
    root: "d212",
    title: "Declaratia unica (D212), a person's income and contributions",
    filing: { via: "formularespv-pf", uploadPath: "/SNMD/d212/d212.xhtml" },
    kits: KITS.D212,
    read: readD212,
    correction: "only rectified",
  },
  D100: {
    root: "declaratie100",
    title: "D100, obligations to the state budget",
    filing: { via: "e-guvernare" },
    kits: KITS.D100,
    read: readD100,
    payableText: obligationsText,
    correction: "only corrected by a D710",
  },
  D300: {
    root: "declaratie300",
    title: "D300, the VAT return",
    filing: { via: "e-guvernare" },
    kits: KITS.D300,
    read: readD300,
    payableText: vatText,
  },
  D112: {
    root: "declaratieUnica",
    title: "D112, an employer's contributions and withheld tax",
    filing: { via: "e-guvernare" },
    kits: KITS.D112,
    read: readD112,
    payableText: obligationsText,
    correction: "only rectified",
  },
} as const satisfies Readonly<Record<string, FormSpec>>;

export type FormName = keyof typeof FORMS;
export const FORM_NAMES = Object.keys(FORMS) as readonly FormName[];

const specOf = (form: FormName): FormSpec => FORMS[form];

type Period = { readonly form: FormName; readonly year: number; readonly month: number; readonly cadence?: Reading["cadence"] };

/** "09.2026", "09.2026 (quarterly)" for a D300 not filed monthly, or for D212 its reporting year. */
export const periodText = (p: Period): string =>
  p.form === "D212"
    ? `reporting year ${p.year}`
    : `${String(p.month).padStart(2, "0")}.${p.year}${p.cadence === undefined || p.cadence === "monthly" ? "" : ` (${p.cadence})`}`;

const periodKey = (year: number, month: number): string => `${year}-${String(month).padStart(2, "0")}`;

/** The package that validates the form for that period; a period none covers is refused. */
export const kitFor = (form: FormName, period: { readonly year: number; readonly month: number }): KitSource => {
  const kits = specOf(form).kits;
  const key = periodKey(period.year, period.month);
  const known = kits.map((k) => (form === "D212" ? k.from.slice(0, 4) : `${k.from}${k.until === undefined ? " on" : ` to ${k.until}`}`)).join(", ");
  return (
    kits.find((k) => key >= k.from && (k.until === undefined || key <= k.until)) ??
    fail(
      inputError(
        `no ANAF validator is known for ${form} for ${form === "D212" ? `reporting year ${period.year}` : key}; known: ${known} ` +
          `(a new "soft J" package goes in domain/declarations/kits.ts)`,
      ),
    )
  );
};

/** What a declaration's XML says about itself. */
export type DeclarationFacts = Reading & {
  readonly form: FormName;
  readonly namespace: string | undefined;
};

/**
 * The facts of a declaration's XML: its root element must be the form's; the
 * form's reader takes the period, the taxpayer and what is payable. The
 * validator judges everything else.
 */
export const factsOf = (xml: string, form: FormName): DeclarationFacts => {
  const spec = specOf(form);
  const elements = elementsOf(xml);
  const root = elements[0] ?? fail(inputError("the file is not XML: no root element"));
  if (root.name !== spec.root) return fail(inputError(`the XML's root is <${root.name}>, not <${spec.root}>: it is not a ${form}`));
  return { form, namespace: root.attributes["xmlns"], ...spec.read(root, elements) };
};

/**
 * What DUKIntegrator said, from its output and its error file (measured
 * with a D212 kit): a valid file prints "Validare fara erori"
 * and writes `ok` to the error file; an invalid one prints "Erori la validare"
 * and writes the errors. It exits 0 either way, so the exit code says nothing.
 */
export const dukVerdict = (output: string, errors: string): { readonly valid: boolean } => ({
  valid: errors.trim() === "ok" && /Validare fara erori/i.test(output) && !/Erori la validare/i.test(output),
});

/** The filing PDF's name: what it is, which period, and the XML it carries. */
export const pdfNameFor = (p: Period, xmlSha256: string): string =>
  p.form === "D212" ? `${p.form}_an-${p.year}_${xmlSha256.slice(0, 12)}.pdf` : `${p.form}_${periodKey(p.year, p.month)}_${xmlSha256.slice(0, 12)}.pdf`;

/** What the line says is payable, by the form's own reading; undefined for a form whose amounts are not read. */
export const payableLine = (facts: DeclarationFacts): string | undefined => {
  const text = specOf(facts.form).payableText;
  return text === undefined || facts.payable === undefined ? undefined : text(facts.payable);
};

/**
 * The line a person confirms before a filing: the form, the period, the
 * taxpayer, what it makes payable, the file, and that it stays filed. Read
 * from the XML the PDF carries, so it says what will be sent.
 */
export const filingLine = (facts: DeclarationFacts, pdf: { readonly name: string; readonly size: number; readonly sha256: string }): string => {
  const name = shortName(facts.name);
  const payable = payableLine(facts);
  const correction = specOf(facts.form).correction;
  return (
    `File ${facts.form}${facts.rectifying ? " (rectifying)" : ""} for ${periodText(facts)} for ${facts.cif ?? "the account holder"}${name === undefined ? "" : ` (${name})`} at ANAF` +
    `${payable === undefined ? "" : `, ${payable}`} (${pdf.name}, ${pdf.size} bytes, sha256 ${pdf.sha256.slice(0, 12)}); a filed declaration cannot be withdrawn` +
    `${correction === undefined ? "" : `, ${correction}`}`
  );
};

export type { KitSource, Payable };
