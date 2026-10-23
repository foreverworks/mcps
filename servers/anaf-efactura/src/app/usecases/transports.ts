import { sha256Of } from "@foreverworks/mcp-kit";

import { type DeclarationReading, declarationProblems, filingSummary } from "../../domain/etransportFiling.js";
import { fail, inputError } from "../../domain/errors.js";
import { parseUploadId } from "../../domain/ids.js";
import { transportReceipt, transportStatus } from "../../domain/transportReceipts.js";
import { resolveCif } from "../cif.js";
import type { Deps } from "../ports.js";
import { filed } from "./filed.js";
import type { DocumentRead } from "./inputFiles.js";

/** e-Factura's limit; ANAF publishes none for e-Transport, and a declaration is a few kilobytes. */
export const MAX_DECLARATION_BYTES = 10 * 1024 * 1024;

/**
 * File an e-Transport declaration (etransport_file): a new transport, its
 * correction, a deletion, a confirmation or a vehicle change, whichever the
 * XML holds. The same shape as upload_invoice: the file is read once, before
 * anyone is asked (the policy's `resolve`); the test environment unless `test`
 * is false; a production filing claims its bytes in the ledger before it is
 * sent and is refused a second time unless `refile`; an answer that is lost
 * is `outcome_unknown` and never sent again. The UIT ANAF answers is valid
 * only once etransport_status says ok.
 */
export type FileTransportArgs = {
  readonly xml: string;
  /** The file the text came from; absent only for a caller inside this process (a test). */
  readonly read?: DocumentRead | undefined;
  readonly cif: string;
  readonly test: boolean;
  readonly refile?: boolean | undefined;
};

/** What makes a declaration unfit to file, found before anyone is asked to confirm it. */
export const ensureFileable = (reading: DeclarationReading): void => {
  if (reading.kind === "unreadable") return fail(inputError(`the declaration was not sent: ${reading.why}`));
  const problems = declarationProblems(reading.declaration);
  if (problems.length > 0) fail(inputError(`the declaration was not sent: ${problems.join("; ")}`));
};

export const fileTransport = async (deps: Deps, args: FileTransportArgs) => {
  const xml = Buffer.from(args.xml, "utf8");
  if (xml.length === 0) fail(inputError("the declaration XML is empty"));
  if (xml.length > MAX_DECLARATION_BYTES) fail(inputError(`the declaration XML is ${xml.length} bytes; at most 10 MB is sent`));
  const sha256 = sha256Of(xml);
  if (args.read !== undefined && args.read.sha256 !== sha256)
    fail(inputError(`the text to file hashes to ${sha256}, not to the ${args.read.sha256} of ${args.read.name}; nothing was sent`));
  const cif = await resolveCif(deps, args.cif);
  const reading = deps.readDeclaration(args.xml);
  ensureFileable(reading);
  const send = async () => transportReceipt(await deps.anaf.fileTransport({ cif, xml, test: args.test }));
  const receipt = args.test
    ? await send()
    : await filed(deps, { sha256, cif, at: new Date(deps.now() * 1000).toISOString(), kind: "etransport" }, args.refile === true, send);
  return {
    ok: true,
    environment: args.test ? "test" : "production",
    cif,
    bytes: xml.length,
    sha256,
    ...(args.read === undefined ? {} : { file: args.read }),
    declaration: reading.kind === "declaration" ? reading.declaration : undefined,
    ...receipt,
  };
};

export const transportStatusOf = async (deps: Deps, args: { idIncarcare: string; test: boolean }) => {
  const idIncarcare = parseUploadId(args.idIncarcare);
  return { ok: true, environment: args.test ? "test" : "production", idIncarcare, ...transportStatus(await deps.anaf.transportStatus(idIncarcare, args.test)) };
};

/** The line a person confirms before a filing runs, from the same reading the filing reports. Never throws. */
export const filingConfirmationLine = (read: (xml: string) => DeclarationReading, args: FileTransportArgs): string =>
  filingSummary(read(args.xml), {
    test: args.test,
    cif: args.cif,
    sha256: args.read?.sha256 ?? sha256Of(Buffer.from(args.xml, "utf8")),
    refile: args.refile === true,
  });
