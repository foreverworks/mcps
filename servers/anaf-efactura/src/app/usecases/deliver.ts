import { fail, inputError } from "../../domain/errors.js";
import type { Deps } from "../ports.js";

/**
 * Where a file a tool made ends up, as the result reports it: saved in the
 * outbox (the path, which the call also links), or, on a server with no outbox
 * its callers can read (Mode.outbox), attached to the result itself. A result
 * never names a path on a disk the caller cannot reach.
 */
export type Delivery =
  | { readonly path: string }
  | { readonly inline: true; readonly name: string; readonly note: string };

/** The outbox folder a tool's `save_dir` asks for is only meaningful with an outbox. */
export const noFolderWithoutOutbox = (deps: Deps, saveDir: string): void => {
  if (!deps.mode.outbox && saveDir !== "") fail(inputError("this server keeps no outbox, so there is no folder to save into: the file comes back in the answer"));
};

/** How a caller is told to give a document: its text with no grant (there is no disk), else by path or checked base64. */
export const howToGive = (deps: Deps, name = "xml"): string =>
  deps.mode.grantless ? `${name}: its XML text` : `${name}: { path } for a file, or { content_base64, sha256 } from a script`;

/** A parameter that reads what the grant fetched or an outbox holds, asked of a server that has neither. */
export const refuseWithoutGrant = (deps: Deps, parameter: string): void => {
  if (deps.mode.grantless) {
    fail(inputError(`${parameter} needs the ANAF grant or an outbox, which this server does not have: pass the document itself instead (xml, and signature for verify_signature), as { path } or { content_base64, sha256 }`));
  }
};

export const deliver = async (deps: Deps, dir: string, name: string, bytes: Buffer): Promise<Delivery> => {
  if (deps.mode.outbox) return { path: await deps.files.writeFile(dir, name, bytes) };
  deps.files.handInline(name, bytes);
  return {
    inline: true,
    name,
    note: `The file (${bytes.length} bytes, sha256 below) is attached to this answer as ${name}; this server keeps no copy, so take it from the attachment.`,
  };
};
