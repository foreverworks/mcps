import { z } from "zod";

import { submitDeclaration, validateDeclaration } from "../../app/usecases/declarations.js";
import { declarationStatus } from "../../app/usecases/status.js";
import { FORM_NAMES, FORMS, type KitSource } from "../../domain/declarations.js";
import { saveDir } from "../args.js";
import type { Registrar } from "./types.js";

const blank = (value: string): string | undefined => (value.trim() === "" ? undefined : value);
const sha256 = z.string().trim().regex(/^[0-9a-fA-F]{64}$/).optional();
/** What validate_declaration covers, from the one table of ANAF's packages: D212 by reporting year, the others from a period on. */
const coverage = (Object.keys(FORMS) as (keyof typeof FORMS)[])
  .map((form) => {
    const kits: readonly KitSource[] = FORMS[form].kits;
    return form === "D212"
      ? `D212 for reporting years ${kits.map((k) => k.from.slice(0, 4)).join(", ")}`
      : `${form} for periods from ${kits.map((k) => `${k.from.slice(5)}.${k.from.slice(0, 4)}`).join(", ")}`;
  })
  .join("; ");

/** submit_declaration's arguments, shared with the policy's line and resolve. */
export const submitInput = (where: string) => ({
  pdf: z.string().trim().min(1).describe(`The filing PDF validate_declaration made: ${where}. Taken by path only, byte for byte.`),
  pdf_sha256: sha256.describe("Its hex SHA-256 as validate_declaration answered it; a mismatch fails and nothing is sent."),
  confirm: z.boolean().default(false).describe("Must be true: a filed declaration cannot be withdrawn, only rectified."),
  refile: z.boolean().default(false).describe("Send these exact bytes again although they were filed (or sent with no answer) before."),
  wait_seconds: z.number().int().min(0).max(120).default(60).describe("How long to wait for SPV's RECIPISA (it usually arrives within seconds)."),
  save_dir: saveDir,
});

export const registerDeclarations: Registrar = (server, deps, handled) => {
  server.registerTool(
    "validate_declaration",
    {
      title: "Validate a declaration",
      description:
        "Validate a declaration's XML with ANAF's own validator for its form and period (DUKIntegrator with the \"soft J\" jars of ANAF's package " +
        `for that period, kept in a cache; ${coverage}), and answer its errors verbatim, with the period, the taxpayer and what it makes payable. ` +
        "With pdf (the default) a valid XML also becomes the filing PDF, saved to the outbox only once its embedded XML is checked to be the validated " +
        "file byte for byte. D212's period is its reporting year, an_r (2023 declares 2022's income). Files nothing: submit_declaration files a D212; " +
        "ANAF takes D100, D300 and D112 only through e-guvernare.ro, signed with a qualified certificate, and the answer says so.",
      inputSchema: {
        form: z.enum(FORM_NAMES as [string, ...string[]]).default("D212").describe(`The form: ${Object.entries(FORMS).map(([name, spec]) => (name === "D212" ? name : spec.title)).join("; ")}.`),
        xml: z.string().trim().min(1).describe(`The declaration's XML: ${deps.inputFiles.where}. Taken by path only, byte for byte.`),
        xml_sha256: sha256.describe("Its hex SHA-256; a mismatch fails before anything runs."),
        year: z.number().int().min(2000).max(2100).optional().describe("The period's year (D212: the reporting year), checked against the XML's."),
        month: z.number().int().min(1).max(12).optional().describe("The period's month, checked against the XML's (D212's is 12)."),
        pdf: z.boolean().default(true).describe("Also make the filing PDF when the XML is valid."),
        save_dir: saveDir,
      },
    },
    handled((a) =>
      validateDeclaration(deps, {
        form: a.form as keyof typeof FORMS,
        year: a.year,
        month: a.month,
        xml: { path: a.xml, sha256: a.xml_sha256?.toLowerCase() },
        pdf: a.pdf,
        saveDir: blank(a.save_dir),
      }),
    ),
  );

  server.registerTool(
    "submit_declaration",
    {
      title: "File a declaration",
      description:
        "File a D212 with ANAF at formularespv-pf, in the account holder's name: the PDF validate_declaration made, and only that (its SHA-256, " +
        "size and embedded XML are checked against what was validated). Signs in to formularespv-pf by itself (its own session; SPV e-mails a code), " +
        "uploads, and answers the index de depunere; then waits for SPV's RECIPISA and downloads it with the DECLARATIE. A filed declaration is a fiscal " +
        "document: it cannot be withdrawn, only rectified. Requires confirm: true; the same bytes are filed once unless refile. A D100, D300 or D112 " +
        "PDF is checked and refused as unsupported before anything is sent: ANAF takes those only through e-guvernare.ro, signed with a qualified certificate.",
      inputSchema: submitInput(deps.inputFiles.where),
    },
    handled((a) =>
      submitDeclaration(deps, {
        pdf: { path: a.pdf, sha256: a.pdf_sha256?.toLowerCase() },
        confirm: a.confirm,
        refile: a.refile,
        waitSeconds: a.wait_seconds,
        saveDir: blank(a.save_dir),
      }),
    ),
  );

  server.registerTool(
    "declaration_status",
    {
      title: "A filing's status",
      description:
        "A filed declaration's state at ANAF and its receipt (recipisa), by its number, from ANAF's public status service (StareD112): no sign-in, " +
        "nothing changes. The number is the index de încărcare a RECIPISA prints (the middle of its registration number INTERNT-<index>-<year>, " +
        "also accepted), or the index de depunere submit_declaration answered. Answers status (processing, not_registered, validation_errors, valid) " +
        "with ANAF's words, the form, the registration number and dates, and saves the signed receipt to the outbox while ANAF serves it (60 days " +
        "after filing). The service lists a tax id's last 200 filings of the last three months; for an older one it says how to ask SPV for a " +
        "duplicate. Any form filed electronically, whoever filed it.",
      inputSchema: {
        reference: z.string().trim().min(1).describe("The index de încărcare (digits), the registration number INTERNT-<index>-<year>, or submit_declaration's index de depunere."),
        cif: z.string().trim().min(1).optional().describe("The CNP or CUI it was filed for; default the one this server filed it for, when it did."),
        receipt: z.boolean().default(true).describe("Save the receipt's signed PDF to the outbox when ANAF still serves it."),
        save_dir: saveDir,
      },
    },
    handled((a) => declarationStatus(deps, { reference: a.reference, cif: a.cif, receipt: a.receipt, saveDir: blank(a.save_dir) })),
  );
};
