import { compact, type FileSource, reportProgress, resolveSaveDir, saveToOutbox, unlessCancelled } from "@foreverworks/mcp-kit";

import { findColumn } from "../../domain/columns.js";
import { describeThrown, fail, inputError, OUTBOX_VARIABLE } from "../../domain/errors.js";
import {
  blockTypeFor,
  contentTypeOf,
  type ExternalFile,
  filesOfBlocks,
  filesOfProperties,
  type HostedFile,
  safeFileName,
  uniqueNames,
} from "../../domain/files.js";
import type { FileRef } from "../../domain/properties/write.js";
import { pageTitle } from "../../domain/properties/read.js";
import type { RawBlock } from "../../domain/schema.js";
import type { Deps, NotionPort } from "../ports.js";
import { columnsFor, pageOf } from "./pages.js";

export type UploadArgs = {
  readonly file: FileSource;
  readonly page: string;
  /** A files column of the row; absent puts the file in a block at the end of the page's body. */
  readonly column?: string;
  /** The name Notion shows; default the file's own. */
  readonly name?: string;
  /** Let a column's Notion-hosted files go: the API cannot write one back. */
  readonly replace: boolean;
  readonly account?: string;
};

/**
 * A file read by path (or from a script's base64 with its checksum), uploaded
 * to Notion and attached to the page: to one of its files columns, after the
 * files already there, or as a block at the end of its body (an image, a PDF,
 * a video or a sound as its own kind of block). Everything that can be refused
 * is refused before the upload starts. The answer reports the bytes sent, by
 * size and SHA-256.
 */
export const uploadFile = async (deps: Deps, args: UploadArgs) => {
  const { account, raw } = await pageOf(deps, args.page, args.account);
  const read = await deps.readInput(args.file);
  const given = args.name?.trim() || read.name;
  if (given === "") return fail(inputError("name the file: content_base64 carries no name of its own"));
  const name = safeFileName(given);
  const contentType = contentTypeOf(name);

  let kept: readonly FileRef[] = [];
  let column: string | undefined;
  if (args.column !== undefined) {
    const found = findColumn(await columnsFor(deps, account, raw), args.column);
    if (found.type !== "files") return fail(inputError(`column "${found.name}" is ${found.type}, not files`));
    column = found.name;
    const current = filesOfProperties(raw.properties, found.name);
    if (current.hosted.length > 0 && !args.replace) {
      return fail(
        inputError(
          `column "${found.name}" already holds ${current.hosted.length} file(s) Notion hosts, which its API cannot write back: ` +
            "replace: true drops them, or leave column out to put the file in the page's body",
        ),
      );
    }
    kept = current.external.map((f) => ({ name: f.name, url: f.url }));
  } else if (args.replace) {
    return fail(inputError("replace goes with column: the page's body is only added to"));
  }

  const api = deps.accounts.api(account);
  const created = await api.createFileUpload(name, contentType);
  const sent = await api.sendFileUpload(created.id, name, contentType, read.bytes);
  if (sent.status !== "uploaded") return fail({ kind: "api", account, status: 0, message: `Notion did not take the file: the upload is ${sent.status}` });

  const file = { name, size: read.size, sha256: read.sha256, contentType };
  if (column !== undefined) {
    await api.updatePage(raw.id, { properties: { [column]: { type: "files", files: [...kept, { name, uploadId: created.id }] } } });
    return { account, page: raw.id, title: pageTitle(raw.properties), column, file };
  }
  const type = blockTypeFor(contentType);
  const appended = await api.appendFileBlock(raw.id, type, created.id);
  const block = appended.results.at(-1)?.id;
  return compact({ account, page: raw.id, title: pageTitle(raw.properties), block, blockType: type, file });
};

/** Blocks read at most when looking for a body's files: a page longer than this is read in part, and the answer says so. */
const BODY_LIMIT = 1000;

/** The blocks of a page's body, nested ones included, down to its child pages and databases (each a page of its own). */
const bodyBlocks = async (api: NotionPort, pageId: string): Promise<{ readonly blocks: readonly RawBlock[]; readonly cut: boolean }> => {
  const blocks: RawBlock[] = [];
  const queue = [pageId];
  while (queue.length > 0) {
    const parent = queue.shift() as string;
    let cursor: string | undefined;
    do {
      const listed = await api.listBlockChildren(parent, 100, cursor);
      for (const b of listed.results) {
        if (!("type" in b)) continue;
        if (blocks.length >= BODY_LIMIT) return { blocks, cut: true };
        blocks.push(b);
        if (b.has_children && b.type !== "child_page" && b.type !== "child_database") queue.push(b.id);
      }
      cursor = listed.has_more ? (listed.next_cursor ?? undefined) : undefined;
    } while (cursor !== undefined);
  }
  return { blocks, cut: false };
};

export type DownloadArgs = {
  readonly page: string;
  /** One files column only; the body is then left alone. */
  readonly column?: string;
  /** Also the body's file, image, PDF, video and audio blocks. */
  readonly body: boolean;
  /** A folder inside the outbox; default one named after the page's id. */
  readonly saveDir?: string;
  readonly account?: string;
};

/**
 * The files Notion hosts for a page, saved to the outbox, each with its path,
 * size and SHA-256: its files columns (or the one named), and the file blocks
 * of its body. External links are listed, never fetched. A file that fails
 * (an expired link, one over the size limit) is listed with why, beside the
 * others.
 */
export const downloadFiles = async (deps: Deps, args: DownloadArgs) => {
  const root = deps.outbox ?? fail({ kind: "config", variable: OUTBOX_VARIABLE, message: `${OUTBOX_VARIABLE} is not set, so there is nowhere to save files` });
  const where = resolveSaveDir(root, args.saveDir);
  if (!where.ok) return fail(inputError(where.reason));
  const { account, raw } = await pageOf(deps, args.page, args.account);
  const api = deps.accounts.api(account);

  const only = args.column === undefined ? undefined : findColumn(await columnsFor(deps, account, raw), args.column);
  if (only !== undefined && only.type !== "files") return fail(inputError(`column "${only.name}" is ${only.type}, not files`));
  const columns = filesOfProperties(raw.properties, only?.name);
  const body = only === undefined && args.body ? await bodyBlocks(api, raw.id) : { blocks: [], cut: false };
  const inBody = filesOfBlocks(body.blocks);
  const hosted: readonly HostedFile[] = [...columns.hosted, ...inBody.hosted];
  const external: readonly ExternalFile[] = [...columns.external, ...inBody.external];

  const dir = args.saveDir === undefined ? `${where.dir}/${raw.id}` : where.dir;
  const names = uniqueNames(hosted.map((f) => safeFileName(f.name)));
  const saved: { name: string; from: string; path: string; size: number; sha256: string }[] = [];
  const failed: { name: string; from: string; error: string }[] = [];
  for (const [i, file] of hosted.entries()) {
    unlessCancelled(`${saved.length} of ${hosted.length} files were saved before it`);
    reportProgress(i, hosted.length, `downloading ${file.name}`);
    try {
      const bytes = await deps.download(file.url);
      const out = await saveToOutbox(dir, names[i] as string, bytes);
      saved.push({ name: names[i] as string, from: file.from, ...out });
    } catch (thrown) {
      failed.push({ name: file.name, from: file.from, error: describeThrown(thrown) });
    }
  }
  return compact({
    account,
    page: raw.id,
    title: pageTitle(raw.properties),
    folder: dir,
    saved,
    external: external.length === 0 ? undefined : external,
    failed: failed.length === 0 ? undefined : failed,
    bodyCut: body.cut ? `only the first ${BODY_LIMIT} blocks of the body were looked through` : undefined,
  });
};
