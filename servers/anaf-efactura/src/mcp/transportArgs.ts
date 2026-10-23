import type { FileSource, InputFile, InputFiles, ToolArgs } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { readDocumentText } from "../app/usecases/inputFiles.js";
import { ensureFileable, type FileTransportArgs } from "../app/usecases/transports.js";
import type { DeclarationReading } from "../domain/etransportFiling.js";
import { fail, inputError } from "../domain/errors.js";
import { documentInput, type FileArg, fileArg } from "./fileArgs.js";
import { testFlag } from "./uploadArgs.js";

/** What a filing is, beside the declaration itself. `test` defaults to TRUE, as upload_invoice's does. */
const SETTINGS = {
  cif: z.string().default("").describe("The CIF filing it (the declarant's). Defaults to app.json's company_cif."),
  test: testFlag,
  refile: z
    .boolean()
    .default(false)
    .describe(
      "File again a declaration whose exact bytes were already sent to production. Refused without it, so a retry " +
        "after a lost answer cannot file it twice: check etransport_status or etransport_list first.",
    ),
};

/** etransport_file's arguments, with the file sentences in the reader's own words. */
export const filingInput = (files: InputFiles) => ({
  xml: fileArg("The e-Transport declaration XML (schema v2)", files),
  ...SETTINGS,
});

/**
 * The arguments once `resolveFiling` has read the declaration: ONE definition,
 * which the policy parses to write the line a person confirms and the tool runs
 * on, so the line describes exactly the call that will run.
 */
export const resolvedFilingArgs = z.object({
  ...SETTINGS,
  xml: z.string().min(1),
  xml_read: z.object({ name: z.string(), size: z.number(), sha256: z.string(), path: z.string().optional() }),
});

export const toFilingArgs = (args: z.infer<typeof resolvedFilingArgs>): FileTransportArgs => ({
  xml: args.xml,
  read: args.xml_read,
  cif: args.cif,
  test: args.test,
  refile: args.refile,
});

/**
 * The filing's arguments with the declaration read (by path, or a script's
 * checked base64) and held to what would make it unfit to file: the policy's
 * `resolve` for etransport_file, and idempotent, so the tool runs it again for
 * a call that did not pass the gate.
 */
export const resolveFiling = async (
  readInput: (source: FileSource) => Promise<InputFile>,
  readDeclaration: (xml: string) => DeclarationReading,
  args: ToolArgs,
): Promise<ToolArgs> => {
  if (typeof args["xml"] === "string" && args["xml_read"] !== undefined) return args;
  const { xml, ...rest } = args;
  const arg = typeof xml === "object" && xml !== null ? (xml as FileArg) : undefined;
  const document = await readDocumentText(readInput, documentInput("xml", arg));
  if (document === undefined) return fail(inputError("give the declaration as xml: { path } for a file, or { content_base64, sha256 } from a script"));
  // Refused here, before anyone is asked to confirm a declaration that cannot be filed as it stands.
  ensureFileable(readDeclaration(document.text));
  return { ...rest, xml: document.text, xml_read: document.read };
};
