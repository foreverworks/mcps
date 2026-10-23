import { describeThrown, fail, inputError } from "../../domain/errors.js";
import { reportProgress, resolveSaveDir, sha256Of, unlessCancelled } from "@foreverworks/mcp-kit";
import { basename, extname } from "node:path";

import { attachmentsOf } from "../../domain/attachments.js";
import { headersOf } from "../../domain/mime.js";
import { DEFAULT_CONCURRENCY, mapWithConcurrency } from "../../infra/pool.js";
import type { Deps } from "../ports.js";

export type HarvestInput = {
  readonly query: string;
  readonly maxThreads: number;
  readonly maxAttachments: number;
  readonly saveDir?: string;
  readonly extensions?: readonly string[];
};

type Candidate = {
  readonly threadId: string;
  readonly messageId: string;
  readonly subject: string | undefined;
  readonly date: string | undefined;
  readonly filename: string;
  readonly attachmentId: string;
  readonly size: number | undefined;
};

/** `<messageId>-<name>`: the real filename is what a human recognises, the id
 *  is what stops two invoices both called `invoice.pdf` from overwriting. */
const fileNameFor = (c: Candidate): string => basename(`${c.messageId}-${c.filename}`);

const wanted = (name: string, extensions: readonly string[]): boolean =>
  extensions.length === 0 || extensions.includes(extname(name).toLowerCase());

/**
 * Every attachment matching a query, on disk, in one call.
 *
 * Gmail's own "download all attachments" zip is keyed by THREAD id and
 * silently omits every part keyed by message id, so a harvest built on it can
 * come up short without saying so. Walking the
 * MIME tree per message and fetching each part by id cannot lose one that way,
 * and the manifest states the count so the caller can reconcile it.
 *
 * Nothing here throws on a per-file failure: one unreadable part is listed in
 * `failed` and the rest still land. A harvest that aborts partway through is
 * worse than useless, because it looks like it worked. The one exception is
 * the client cancelling: then nothing more is fetched and the call ends as
 * cancelled, never as a manifest that looks complete. A client that asked
 * hears each attachment saved, out of how many.
 */
export const harvestAttachments = async (deps: Deps, input: HarvestInput) => {
  const extensions = (input.extensions ?? []).map((e) => (e.startsWith(".") ? e : `.${e}`).toLowerCase());
  const page = await deps.gmail.listThreads({
    ...(input.query ? { query: input.query } : {}),
    maxResults: input.maxThreads,
  });
  const ids = (page.threads ?? []).flatMap((t) => (t.id ? [t.id] : []));
  const threads = await deps.gmail.getThreads(ids, { format: "full" });

  const candidates: Candidate[] = [];
  const unreadable: { readonly threadId: string; readonly reason: string }[] = [];
  threads.forEach((result, i) => {
    const threadId = ids[i] as string;
    if (!result.ok) {
      unreadable.push({ threadId, reason: result.reason });
      return;
    }
    for (const message of result.value.messages ?? []) {
      const h = headersOf(message.payload);
      for (const a of attachmentsOf(message.payload ?? {})) {
        if (!wanted(a.filename, extensions)) continue;
        candidates.push({
          threadId,
          messageId: message.id ?? "",
          subject: h["Subject"],
          date: h["Date"],
          filename: a.filename,
          attachmentId: a.attachmentId,
          size: a.size,
        });
      }
    }
  });

  const truncated = candidates.length > input.maxAttachments;
  const selected = candidates.slice(0, input.maxAttachments);
  const where = resolveSaveDir(deps.paths.attachmentsDir, input.saveDir);
  if (!where.ok) return fail(inputError(where.reason));
  const dir = where.dir;

  const progress = { done: 0 };
  const total = selected.length;
  const counted = (n: number, what: string): string => `${n} ${what}${n === 1 ? "" : "s"}`;
  reportProgress(0, total, `${counted(total, "attachment")} to save from ${counted(ids.length, "thread")}`);
  const outcomes = await mapWithConcurrency(selected, DEFAULT_CONCURRENCY, async (c) => {
    const left = "the attachments not yet fetched were not saved";
    unlessCancelled(left);
    const outcome = await (async () => {
      try {
        const bytes = await deps.gmail.getAttachment(c.messageId, c.attachmentId);
        const path = await deps.files.writeFile(dir, fileNameFor(c), bytes);
        return { ok: true as const, saved: { ...c, path, bytes: bytes.length, sha256: sha256Of(bytes) } };
      } catch (thrown) {
        unlessCancelled(left);
        const reason = describeThrown(thrown);
        return { ok: false as const, failed: { ...c, reason } };
      }
    })();
    progress.done += 1;
    reportProgress(progress.done, total, `${progress.done} of ${total} attachments`);
    return outcome;
  });

  const saved = outcomes.flatMap((o) => (o.ok ? [o.saved] : []));
  const failed = outcomes.flatMap((o) => (o.ok ? [] : [o.failed]));

  return {
    account: deps.account,
    query: input.query,
    dir,
    // The reconciliation numbers, stated rather than left to be counted: a
    // harvest is only trustworthy if you can check it against Gmail's own
    // has:attachment count.
    threadsMatched: ids.length,
    attachmentsFound: candidates.length,
    savedCount: saved.length,
    failedCount: failed.length,
    truncated,
    bytesTotal: saved.reduce((n, s) => n + s.bytes, 0),
    saved,
    failed,
    unreadableThreads: unreadable,
    nextPageToken: page.nextPageToken,
  };
};
