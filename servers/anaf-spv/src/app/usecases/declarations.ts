import { compact } from "@foreverworks/mcp-kit";

import { type DeclarationFacts, factsOf, filingLine, FORMS, type FormName, kitFor, type Payable, pdfNameFor, periodText } from "../../domain/declarations.js";
import { isoAt } from "../../domain/dates.js";
import { drift, fail, inputError } from "../../domain/errors.js";
import { folded, type Message, messageView, newestFirst } from "../../domain/messages.js";
import { registrationIn } from "../../domain/status.js";
import { embeddedFiles } from "../../infra/pdf.js";
import type { DeclarationEntry, Deps } from "../ports.js";
import { download, saveDirOf, withListing } from "./messages.js";
import { withSession, withSessionAt } from "./session.js";

/**
 * Declarations, from XML to a filing:
 *
 *   validate_declaration  ANAF's own validator for the form and reporting
 *                         year, and the filing PDF it makes, checked to carry
 *                         the validated XML byte for byte;
 *   submit_declaration    that PDF, and only a PDF this server made and
 *                         checked, uploaded at formularespv-pf; then SPV's
 *                         receipt (RECIPISA), downloaded.
 *
 * A filed declaration is a fiscal document: it cannot be withdrawn, only
 * rectified. So the filing tool is `money`, takes the file by path only,
 * requires confirm: true, and files the same bytes once unless refile.
 */

const UTF8 = new TextDecoder("utf-8", { fatal: true });

const xmlText = (bytes: Uint8Array, name: string): string => {
  try {
    return UTF8.decode(bytes);
  } catch {
    return fail(inputError(`${name} is not UTF-8 text; a declaration's XML is`));
  }
};

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));

/** What a return makes payable, as a client sees it. */
const payableView = (payable: Payable | undefined) =>
  payable === undefined
    ? undefined
    : compact({
        total_lei: payable.total,
        items: payable.items.length === 0 ? undefined : payable.items.map((i) => ({ code: i.code, lei: i.lei })),
        refundable_lei: payable.refundable === undefined || payable.refundable === "0" ? undefined : payable.refundable,
        refund_asked: payable.refundAsked,
      });

/** How a valid form's PDF gets filed: here, or (for the forms ANAF takes only through e-guvernare) where and with what. */
const filingNext = (facts: DeclarationFacts, where: string): string =>
  FORMS[facts.form].filing.via === "formularespv-pf"
    ? `to file it, copy the PDF into ${where} and call submit_declaration with it and confirm: true; a filed declaration cannot be withdrawn, only rectified`
    : `ANAF takes a ${facts.form} only through e-guvernare.ro (decl.anaf.mfinante.gov.ro), as this PDF signed with a qualified certificate of someone ` +
      `entitled to file for ${facts.cif ?? "the taxpayer"}; this server holds no such certificate, so submit_declaration checks the PDF and stops before sending. ` +
      "Sign the PDF and upload it there; then declaration_status with the index its receipt gives";

export const validateDeclaration = async (
  deps: Deps,
  args: {
    readonly form: FormName;
    readonly year: number | undefined;
    readonly month: number | undefined;
    readonly xml: { readonly path: string; readonly sha256: string | undefined };
    readonly pdf: boolean;
    readonly saveDir: string | undefined;
  },
) => {
  const dir = args.pdf ? saveDirOf(deps, args.saveDir) : undefined;
  const file = await deps.inputFiles({ path: args.xml.path, sha256: args.xml.sha256 });
  const facts = factsOf(xmlText(file.bytes, file.name), args.form);
  if (args.year !== undefined && args.year !== facts.year) fail(inputError(`the XML declares ${periodText(facts)}, not year ${args.year}: the period is the one the XML declares`));
  if (args.month !== undefined && args.month !== facts.month) fail(inputError(`the XML declares ${periodText(facts)}, not month ${args.month}: the period is the one the XML declares`));
  const kit = kitFor(args.form, facts);
  const run = await deps.duk.run({ form: args.form, kit, xml: file.bytes, pdf: args.pdf });
  const base = {
    ok: true as const,
    form: facts.form,
    year: facts.year,
    month: facts.month,
    period: periodText(facts),
    ...(facts.cadence === undefined ? {} : { cadence: facts.cadence }),
    ...(facts.cif === undefined ? {} : { cif: facts.cif }),
    ...(facts.name === undefined ? {} : { name: facts.name }),
    ...(facts.namespace === undefined ? {} : { namespace: facts.namespace }),
    rectifying: facts.rectifying,
    ...(facts.payable === undefined ? {} : { payable: payableView(facts.payable) }),
    filed_through: FORMS[facts.form].filing.via,
    xml: { name: file.name, bytes: file.size, sha256: file.sha256 },
    kit: { package: compact({ zip: kit.zip, version: kit.version, published: kit.published }), built_at: run.kit.builtAt, files: run.kit.files.map((f) => ({ file: f.file, source: f.source, sha256: f.sha256 })) },
  };
  if (!run.valid) return { ...base, valid: false as const, errors: run.errors, output: run.output, next: "fix what errors names (the validator's own words) and validate again" };
  if (dir === undefined) return { ...base, valid: true as const, errors: run.errors, output: run.output };
  const pdf = run.pdf ?? fail(drift(`DUKIntegrator validated the XML but made no PDF: ${run.pdfFailure ?? run.output}`));
  const attached = embeddedFiles(pdf);
  if (attached.length !== 1 || !sameBytes(attached[0] ?? new Uint8Array(), file.bytes)) {
    fail(drift(`the PDF DUKIntegrator made carries ${attached.length} attachment(s), not the validated XML byte for byte; it was not saved`));
  }
  const saved = await deps.files.save(dir, pdfNameFor(facts, file.sha256), pdf);
  const pdfSha256 = deps.sha256(pdf);
  const before = (await deps.declarations.read())[pdfSha256];
  const entry: DeclarationEntry = {
    form: facts.form,
    year: facts.year,
    month: facts.month,
    cif: facts.cif,
    xmlSha256: file.sha256,
    pdfSha256,
    pdfBytes: pdf.byteLength,
    pdfName: saved.path.slice(saved.path.lastIndexOf("/") + 1),
    validatedAtMs: deps.now(),
    ...(before?.filed === undefined ? {} : { filed: before.filed }),
  };
  await deps.declarations.record(entry);
  return {
    ...base,
    valid: true as const,
    errors: run.errors,
    output: run.output,
    pdf: { path: saved.path, bytes: pdf.byteLength, sha256: pdfSha256, embedded_xml_identical: true as const },
    next: filingNext(facts, deps.inputFiles.where.replace(/^a file in /, "")),
  };
};

/**
 * The PDF a filing would send, read and checked against what
 * validate_declaration made, and the line a person confirms, read from the
 * XML that PDF carries: the policy's resolve and the tool share it, so the
 * line names what the bytes sent say.
 */
export const filingOf = async (deps: Deps, pdf: { readonly path: string; readonly sha256: string | undefined }) => {
  const file = await deps.inputFiles({ path: pdf.path, sha256: pdf.sha256 });
  const entry =
    (await deps.declarations.read())[file.sha256] ??
    fail(inputError(`${file.name} (sha256 ${file.sha256.slice(0, 12)}) is not a PDF this server made: only a PDF validate_declaration made and checked can be filed`));
  if (entry.pdfBytes !== file.size) fail(inputError(`${file.name} has ${file.size} bytes; the PDF validate_declaration made had ${entry.pdfBytes}`));
  const carried =
    embeddedFiles(file.bytes).find((x) => deps.sha256(x) === entry.xmlSha256) ??
    fail(inputError(`${file.name} does not carry the XML that was validated (sha256 ${entry.xmlSha256.slice(0, 12)})`));
  const facts = factsOf(xmlText(carried, `the XML inside ${file.name}`), entry.form);
  return { file, entry, facts, line: filingLine(facts, { name: file.name, size: file.size, sha256: file.sha256 }) };
};

/** The receipt and the declaration SPV posts for a filing: rows of the form and period, posted since it was sent (two minutes' grace for clocks). */
const receiptsOf = (messages: readonly Message[], entry: DeclarationEntry, sinceMs: number) => {
  const recent = messages.filter((m) => m.postedAtMs >= sinceMs - 120_000).sort(newestFirst);
  const period = `${String(entry.month ?? 12).padStart(2, "0")}.${entry.year}`;
  return {
    recipisa: recent.find((m) => folded(m.type) === "recipisa" && folded(m.details).includes(`tip ${folded(entry.form)}`) && folded(m.details).includes(`perioada raportare ${period}`)),
    declaration: recent.find((m) => folded(m.type) === "declaratie" && folded(m.details).includes(`pentru anul ${entry.year}`)),
  };
};

export const submitDeclaration = async (
  deps: Deps,
  args: { readonly pdf: { readonly path: string; readonly sha256: string | undefined }; readonly confirm: boolean; readonly refile: boolean; readonly waitSeconds: number; readonly saveDir: string | undefined },
) => {
  const dir = saveDirOf(deps, args.saveDir);
  const { file, entry, line } = await filingOf(deps, args.pdf);
  const filing = FORMS[entry.form].filing;
  if (filing.via !== "formularespv-pf") {
    return fail({
      kind: "unsupported",
      message:
        `nothing was sent: ANAF takes a ${entry.form} only through e-guvernare.ro, signed with a qualified certificate, which this server does not hold. ` +
        `The PDF is checked and ready to be signed and uploaded there; what it files: ${line}`,
    });
  }
  if (!args.confirm) fail(inputError(`confirm: true is required to file; nothing was sent. It would: ${line}`));
  const filed = entry.filed;
  if (filed !== undefined && filed.outcome !== "refused" && !args.refile) {
    fail(
      inputError(
        filed.outcome === "accepted"
          ? `this PDF was filed on ${isoAt(filed.atMs)} with index de depunere ${filed.index ?? "?"}; nothing was sent. A correction is a rectifying declaration; refile: true sends these same bytes again`
          : `this PDF was sent at ${isoAt(filed.atMs)} and the answer never came, so it may be filed: look in SPV (list_messages type DECLARATIE) before refile: true`,
      ),
    );
  }
  const sentAtMs = deps.now();
  await deps.declarations.record({ ...entry, filed: { atMs: sentAtMs, outcome: "pending" } });
  const outcome = await withSessionAt(deps, deps.forms.site, () => deps.forms.pages.upload({ path: filing.uploadPath, fileName: file.name, bytes: file.bytes }));
  if (outcome.kind === "refused") {
    await deps.declarations.record({ ...entry, filed: { atMs: sentAtMs, outcome: "refused" } });
    return fail({ kind: "refused", message: `formularespv-pf did not take the file: ${outcome.message}` });
  }
  await deps.declarations.record({ ...entry, filed: { atMs: sentAtMs, outcome: "accepted", index: outcome.index } });

  // SPV posts a DECLARATIE (its file named <index>_depunere.pdf) and the RECIPISA within seconds.
  const deadline = deps.now() + args.waitSeconds * 1000;
  let found: { recipisa?: unknown; declaration?: unknown; registration?: ReturnType<typeof registrationIn> } = {};
  for (;;) {
    found = await withSession(deps, () =>
      withListing(deps, async (listed) => {
        const rows = receiptsOf(listed.messages, entry, sentAtMs);
        return {
          ...(rows.recipisa === undefined ? {} : { recipisa: await download(deps, listed, rows.recipisa, dir), registration: registrationIn(rows.recipisa.details) }),
          ...(rows.declaration === undefined ? {} : { declaration: await download(deps, listed, rows.declaration, dir) }),
        };
      }),
    );
    if (found.recipisa !== undefined || deps.now() + deps.pollMs > deadline) break;
    await deps.sleep(deps.pollMs);
  }
  // The RECIPISA names the index de încărcare ANAF's status service knows the filing by: kept, so declaration_status finds it by either number.
  const registration = found.registration;
  if (registration !== undefined) {
    await deps.declarations.record({ ...entry, filed: { atMs: sentAtMs, outcome: "accepted", index: outcome.index, uploadIndex: registration.index, registration: registration.number } });
  }
  const declaration = found.declaration as { file_name?: string } | undefined;
  return {
    ok: true as const,
    filed: true as const,
    index_de_depunere: outcome.index,
    ...(registration === undefined ? {} : { index_de_incarcare: registration.index, registration_number: registration.number }),
    form: entry.form,
    year: entry.year,
    ...(entry.cif === undefined ? {} : { cif: entry.cif }),
    pdf: { name: file.name, bytes: file.size, sha256: file.sha256 },
    ...(found.recipisa === undefined
      ? { recipisa: { found: false as const, next: `SPV posts the RECIPISA within a minute or two: list_messages type RECIPISA since ${isoAt(sentAtMs).slice(0, 10)}, then download_message` } }
      : { recipisa: found.recipisa }),
    ...(declaration === undefined ? {} : { declaration: { ...declaration, carries_index: (declaration.file_name ?? "").startsWith(`${outcome.index}_`) } }),
    next: `declaration_status with ${registration?.index ?? outcome.index} follows ANAF's processing of it and saves its receipt`,
  };
};

export { messageView };
