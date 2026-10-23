import { pause, reportProgress, resolveSaveDir, unlessCancelled } from "@foreverworks/mcp-kit";

import { isoAt } from "../../domain/dates.js";
import { fail, inputError, notFound } from "../../domain/errors.js";
import { fileNameFor, keyed, type Message, matches, messageView, newestFirst, type Selection, servedNameFits, typeCounts } from "../../domain/messages.js";
import type { Deps, Downloaded, MessagesView, SyncedEntry } from "../ports.js";
import { withSession } from "./session.js";

/** A listing, named: the rows keyed, in the portal's order, with the view to download from. */
export type Listing = { readonly view: MessagesView; readonly messages: readonly Message[] };

/**
 * List, and run `use` on the listing as one operation on the session: its
 * downloads point at rows of this listing, so nothing may list in between.
 */
export const withListing = <T>(deps: Deps, use: (listed: Listing) => Promise<T>): Promise<T> => deps.portal.withMessages((view) => use({ view, messages: keyed(view.rows) }));

export const saveDirOf = (deps: Deps, requested: string | undefined): string => {
  const place = resolveSaveDir(deps.files.root, requested);
  return place.ok ? place.dir : fail(inputError(place.reason));
};

/** The saved file as a client sees it. */
const savedView = (deps: Deps, m: Message, downloaded: Downloaded, saved: { readonly path: string; readonly present: boolean }) => ({
  path: saved.path,
  already_there: saved.present,
  file_name: downloaded.fileName,
  content_type: downloaded.contentType,
  bytes: downloaded.bytes.byteLength,
  sha256: deps.sha256(downloaded.bytes),
  message: messageView(m),
});

export const listMessages = async (deps: Deps, args: Selection & { readonly limit: number }) => {
  const messages = await withSession(deps, () => withListing(deps, async (listed) => listed.messages));
  const selected = messages.filter(matches(args)).sort(newestFirst);
  return {
    ok: true as const,
    total: messages.length,
    matched: selected.length,
    items: selected.slice(0, args.limit).map(messageView),
    ...(selected.length > args.limit ? { more: selected.length - args.limit } : {}),
    types: typeCounts(messages),
  };
};

/** Download `m` from its listing and save it, unless SPV's name for the file says it is another message's. */
export const download = async (deps: Deps, listed: Listing, m: Message, dir: string) => {
  const downloaded = await listed.view.download(listed.messages.indexOf(m));
  const fits = servedNameFits(m, downloaded.fileName, listed.messages);
  if (!fits.ok) fail({ kind: "wrong_document", key: m.key, message: `${fits.reason}; not saved` });
  const saved = await deps.files.save(dir, fileNameFor(m, downloaded.fileName), downloaded.bytes);
  return savedView(deps, m, downloaded, saved);
};

/** The listing and its downloads are one operation: a session that ends between them is signed in again and the whole of it runs again. */
export const downloadMessage = async (deps: Deps, args: { readonly key: string; readonly saveDir: string | undefined }) => {
  const dir = saveDirOf(deps, args.saveDir);
  return withSession(deps, () =>
    withListing(deps, async (listed) => {
      const m = listed.messages.find((x) => x.key === args.key.trim()) ?? fail(notFound(`no message with key ${args.key} in SPV's list now (${listed.messages.length} messages); it may have been archived`));
      return { ok: true as const, ...(await download(deps, listed, m, dir)) };
    }),
  );
};

/**
 * Save every message the ledger has not seen, oldest first, so a run cut
 * short leaves the ledger true. SPV drops a row about two months after it
 * posted it (ten years for payments), so this is what keeps the documents.
 */
export const syncMessages = async (deps: Deps, args: Selection & { readonly saveDir: string | undefined; readonly limit: number }) => {
  const dir = saveDirOf(deps, args.saveDir);
  // Run again whole after a sign-in: the ledger already holds what the first run saved.
  return withSession(deps, () => withListing(deps, (listed) => syncOnce(deps, listed, args, dir)));
};

const syncOnce = async (deps: Deps, listed: Listing, args: Selection & { readonly limit: number }, dir: string) => {
  const { messages } = listed;
  const ledger = await deps.ledger.read();
  const wanted = messages.filter(matches(args));
  const todo = wanted.filter((m) => ledger[m.key] === undefined).sort((a, b) => -newestFirst(a, b));
  const batch = todo.slice(0, args.limit);
  const saved: ReturnType<typeof savedView>[] = [];
  // A client that asked hears each document saved; one that cancels stops between documents, each
  // already in the ledger, so the next sync carries on from there.
  reportProgress(0, batch.length, `${batch.length} of ${todo.length} new documents to save`);
  for (const m of batch) {
    unlessCancelled(`${batch.length - saved.length} documents were not downloaded; sync_messages carries on from there`);
    const one = await download(deps, listed, m, dir);
    const entry: SyncedEntry = { path: one.path, sha256: one.sha256, savedAtMs: deps.now() };
    await deps.ledger.record({ [m.key]: entry });
    saved.push(one);
    reportProgress(saved.length, batch.length, `${saved.length} of ${batch.length} documents saved`);
  }
  return {
    ok: true as const,
    listed: messages.length,
    matched: wanted.length,
    already_saved: wanted.length - todo.length,
    saved: saved.map((s) => ({ path: s.path, sha256: s.sha256, bytes: s.bytes, already_there: s.already_there, message: s.message })),
    ...(todo.length > batch.length ? { remaining: todo.length - batch.length, next: "call sync_messages again for the rest" } : {}),
  };
};

/**
 * Wait for SPV's answer to a request (a RASPUNS SOLICITARE row carrying its
 * id). Measured: 40 to 90 seconds after request_document. A client that asked
 * hears the seconds waited of `waitSeconds` after each look; one that cancels
 * ends the wait at once.
 */
export const awaitReply = async (deps: Deps, args: { readonly requestId: string; readonly waitSeconds: number; readonly download: boolean; readonly saveDir: string | undefined }) => {
  const id = args.requestId.trim();
  if (!/^\d+$/.test(id)) fail(inputError("request_id is the number request_document returned"));
  const dir = args.download ? saveDirOf(deps, args.saveDir) : undefined;
  const started = deps.now();
  const deadline = started + args.waitSeconds * 1000;
  for (;;) {
    const found = await withSession(deps, () =>
      withListing(deps, async (listed) => {
        const reply = listed.messages.filter((m) => m.requestId === id).sort(newestFirst)[0];
        if (reply === undefined) return undefined;
        if (dir === undefined) return { ok: true as const, answered: true as const, message: messageView(reply) };
        return { ok: true as const, answered: true as const, ...(await download(deps, listed, reply, dir)) };
      }),
    );
    if (found !== undefined) return found;
    if (deps.now() + deps.pollMs > deadline) {
      return {
        ok: true as const,
        answered: false as const,
        checked_at: isoAt(deps.now()),
        next: "SPV answers most requests within two minutes; call await_reply again, or list_messages with request_id later",
      };
    }
    const waited = Math.round((deps.now() - started) / 1000);
    reportProgress(waited, args.waitSeconds, `no answer to request ${id} after ${waited} s; looking again every ${Math.round(deps.pollMs / 1000)} s`);
    await pause(deps.pollMs, deps.sleep, `SPV was not asked again for request ${id}`);
  }
};
