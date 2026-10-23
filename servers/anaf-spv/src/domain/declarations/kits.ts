/**
 * The ANAF packages this server validates and makes filing PDFs with: one
 * place, so a new version ANAF publishes is a new row here and nothing else
 * (the README's table of them is held to this one by a test). Pure data.
 *
 * Each row is a "soft J" zip from static.anaf.ro's
 * Declaratii_R/AplicatiiDec, holding the form's `<FORM>Validator.jar` and
 * `<FORM>Pdf.jar`, and the reporting periods it validates, from the form's
 * page and the validator's own table of periods. A period no row covers is
 * refused, never validated with the nearest package.
 *
 * - D212 has one package per reporting year: a year's XML validated with
 *   another year's fails on its namespace or its rules (read 2026-10-18 from
 *   declaratie_unica.html). The reporting year is the year filed in: 2023
 *   declares 2022's income.
 * - D100, D300 and D112 have one package for many periods: the validator
 *   picks the rules of the XML's period from a table inside it (read
 *   2026-10-22 from the jars; measured: the D112 package refuses a 12.2024
 *   XML in the 07.2026 namespace and names the one that period takes). Their
 *   jars are the same bytes as the ones update5/versiuni.xml lists as current.
 */
export type KitSource = {
  /** The zip's name in Declaratii_R/AplicatiiDec. */
  readonly zip: string;
  /** The first reporting period it validates, YYYY-MM. */
  readonly from: string;
  /** The last, when it is not the current package. */
  readonly until?: string;
  /** ANAF's version of the validator and of the PDF maker (versiuni.xml), where known. */
  readonly version?: string;
  /** When ANAF published it, YYYY-MM-DD (the forms page, the zip's own date). */
  readonly published: string;
  /** What the forms page says it implements. */
  readonly basis?: string;
};

const year = (y: number, zip: string, published: string, rest: Partial<KitSource> = {}): KitSource => ({ zip, from: `${y}-12`, until: `${y}-12`, published, ...rest });

export const KITS = {
  D212: [
    year(2020, "D212_20200622.zip", "2020-06-22"),
    year(2021, "D212_20210512_1607.zip", "2021-05-12"),
    year(2022, "D212_20220301.zip", "2022-03-01"),
    year(2023, "D212_20231002.zip", "2023-10-02"),
    year(2024, "D212_20240708.zip", "2024-07-08"),
    // The same bytes as update5's current D212_40 (measured 2026-10-18). 2026 has no soft J yet, only ANAF's web app.
    year(2025, "D212Validator_01082025.zip", "2025-08-01", { version: "J13.0.1, PDF P10.0.0" }),
  ],
  D100: [
    {
      zip: "D100_14092026.zip",
      // The validator's table starts at 01.2024 (J18.0.3); 01.2025 J20.0.3; 01.2026 J21.0.8.
      from: "2024-01",
      version: "J21.0.8, PDF P6.0.0",
      published: "2026-09-14",
      basis: "OPANAF 57/2026 from 01.2026; obligation 704 from 08.2026",
    },
  ],
  D300: [
    {
      zip: "D300Validator_11022026_2.zip",
      // The validator's table starts at 05.2024 (J9.0.3); 01.2025 J10.0.1; 08.2025 J11.0.1; 01.2026 J12.0.1.
      from: "2024-05",
      version: "J12.0.1, PDF P9.0.0",
      published: "2026-02-11",
      basis: "OPANAF 174/2026, structure v12 from 01.2026",
    },
  ],
  D112: [
    {
      zip: "D112_09102026.zip",
      // The validator's table starts at 01.2025 (J24.0.0); 08.2025 J25.1.1; 01.2026 J26.0.3; 07.2026 J27.0.7.
      from: "2025-01",
      version: "J27.0.7, PDF P3.0.1",
      published: "2026-10-09",
      basis: "joint order 605/95/928/2314/2026, structure v7 from 07.2026",
    },
  ],
} as const satisfies Readonly<Record<string, readonly KitSource[]>>;
