import { resolveSaveDir } from "@foreverworks/mcp-kit";

import { archiveName } from "../../domain/archive.js";
import { fail, inputError } from "../../domain/errors.js";
import { parseMessageId } from "../../domain/ids.js";
import { messageListing, pagedMessageListing } from "../../domain/messages.js";
import { parseDays, parseFilter, parseWindow } from "../../domain/window.js";
import { resolveCif } from "../cif.js";
import type { Deps } from "../ports.js";
import { checkedArchive, fetchArchive } from "./archive.js";

/**
 * Fetch, then map. The fetch is the only impure step; everything that turns
 * ANAF's Romanian wire shape into a usable message is a pure function over the
 * response, which is why the rules have tests and the adapter does not need any.
 */
export const listInvoices = async (deps: Deps, args: { zile: number; cif: string; test: boolean }) =>
  messageListing(
    await deps.anaf.listMessages({
      cif: await resolveCif(deps, args.cif),
      zile: parseDays(args.zile),
      test: args.test,
    }),
  );

export const listInvoicesWindow = async (
  deps: Deps,
  args: { startDate: string; endDate: string; cif: string; page: number; filtru: string; test: boolean },
) => {
  const window = parseWindow(args.startDate, args.endDate);
  const filtru = parseFilter(args.filtru);
  return pagedMessageListing(
    await deps.anaf.listMessagesPaginated({
      cif: await resolveCif(deps, args.cif),
      ...window,
      pagina: args.page,
      ...(filtru === undefined ? {} : { filtru }),
      test: args.test,
    }),
  );
};

/**
 * Save one signed archive to disk, in the outbox or a folder under it: the
 * service can write nowhere else, and a `save_dir` outside it is refused with
 * the remedy BEFORE anything is downloaded. The archive is checked before it
 * is written (checkedArchive: it opens, every entry matches its CRC, the seal
 * is there and is checked against the document), and the answer says what was
 * saved: its sha256 and size, each entry's, and the seal's verdict.
 */
export const downloadInvoice = async (deps: Deps, args: { messageId: string; saveDir: string; test: boolean }) => {
  const messageId = parseMessageId(args.messageId);
  const name = archiveName(messageId);
  const where = resolveSaveDir(deps.paths.downloadsDir, args.saveDir);
  if (!where.ok) return fail(inputError(where.reason));
  const bytes = await fetchArchive(deps, messageId, args.test);
  const checked = checkedArchive(deps, `for message ${messageId}`, bytes);
  return { ok: true, messageId, path: await deps.files.writeFile(where.dir, name, bytes), ...checked };
};
