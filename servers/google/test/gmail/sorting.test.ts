/**
 * The tools for sorting a mailbox: the sender breakdown that plans it, the
 * bulk label change that does it, and the filters that keep it sorted.
 */
import { describe, expect, it, vi } from "vitest";

import { createFilter, deleteFilter, listFilters } from "../../src/gmail/app/usecases/filters.js";
import { trash } from "../../src/gmail/app/usecases/organize.js";
import { modifyLabelsMatching } from "../../src/gmail/app/usecases/matching.js";
import { senderBreakdown } from "../../src/gmail/app/usecases/senders.js";
import { matchingThreadIds, withSecondPass } from "../../src/gmail/app/usecases/bulk.js";
import { asAppError, fail, quotaError } from "../../src/gmail/domain/errors.js";
import { filterSpec, filterView, queryOf } from "../../src/gmail/domain/filters.js";
import { breakdown, threadSender } from "../../src/gmail/domain/senders.js";
import type { GmailPort } from "../../src/gmail/app/ports.js";
import { depsWith, gmailStub, grantStub, MODIFY, writeStub } from "./fakes.js";

const SETTINGS = "https://www.googleapis.com/auth/gmail.settings.basic";

const errorOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (thrown) {
    return asAppError(thrown);
  }
  throw new Error("expected a failure");
};

const labels = async () => ({
  labels: [
    { id: "INBOX", name: "INBOX", type: "system" },
    { id: "UNREAD", name: "UNREAD", type: "system" },
    { id: "Label_3", name: "Newsletters", type: "user" },
  ],
});

/** A mailbox of `n` threads t0..t(n-1), listed `pageSize` at a time as Gmail pages them. */
const pagedThreads = (n: number, pageSize: number): GmailPort["listThreads"] =>
  vi.fn(async ({ maxResults, pageToken }) => {
    const start = Number(pageToken ?? 0);
    const end = Math.min(start + Math.min(maxResults, pageSize), n);
    const threads = Array.from({ length: end - start }, (_, i) => ({ id: `t${start + i}` }));
    return end < n ? { threads, nextPageToken: String(end) } : { threads };
  });

const message = (from: string, labelIds: readonly string[], internalDate: string) => ({
  labelIds: [...labelIds],
  internalDate,
  payload: { headers: [{ name: "From", value: from }] },
});

describe("matchingThreadIds", () => {
  it("walks every page and says when the query matches more than the limit", async () => {
    const deps = depsWith({ gmail: gmailStub({ listThreads: pagedThreads(1200, 500) }) });
    const all = await matchingThreadIds(deps, "in:inbox", 5000);
    expect(all.ids).toHaveLength(1200);
    expect(all.more).toBe(false);

    const capped = await matchingThreadIds(deps, "in:inbox", 1000);
    expect(capped.ids).toHaveLength(1000);
    expect(capped.more).toBe(true);
  });

  it("tells exactly-the-limit from more-than-the-limit", async () => {
    const deps = depsWith({ gmail: gmailStub({ listThreads: pagedThreads(1000, 500) }) });
    expect(await matchingThreadIds(deps, "q", 1000)).toMatchObject({ more: false });
    expect((await matchingThreadIds(deps, "q", 1000)).ids).toHaveLength(1000);
  });
});

describe("withSecondPass", () => {
  it("runs the throttled items again, slowly, and keeps every outcome in item order", async () => {
    const calls: { batch: readonly string[]; concurrency: number }[] = [];
    const seen = new Set<string>();
    const out = await withSecondPass(
      ["a", "b", "c", "d"],
      async (batch, concurrency) => {
        calls.push({ batch, concurrency });
        return batch.map((x) => {
          const first = !seen.has(x);
          seen.add(x);
          return first && (x === "b" || x === "d") ? `${x}:quota` : `${x}:ok`;
        });
      },
      (o) => o.endsWith(":quota"),
    );
    expect(out).toEqual(["a:ok", "b:ok", "c:ok", "d:ok"]);
    expect(calls).toEqual([{ batch: ["a", "b", "c", "d"], concurrency: 16 }, { batch: ["b", "d"], concurrency: 4 }]);
  });
});

describe("modifyLabelsMatching", () => {
  it("changes nothing on a dry run, and counts and samples the matches", async () => {
    const modifyThread = vi.fn(async () => ({}));
    const getThreads = vi.fn(async (ids: readonly string[]) => ids.map((id) => ({ ok: true as const, value: { id, messages: [message("A <a@x.example>", [], "1")] } })));
    const deps = depsWith({ gmail: gmailStub({ labels, listThreads: pagedThreads(30, 500), getThreads }), write: writeStub({ modifyThread }) });
    const out = await modifyLabelsMatching(deps, { query: "from:x.com", add: ["newsletters"], remove: ["inbox"], apply: false, limit: 1000 });
    expect(modifyThread).not.toHaveBeenCalled();
    expect(out).toMatchObject({ dryRun: true, matched: 30, more: false, added: ["Label_3"], removed: ["INBOX"] });
    expect("sample" in out && out.sample).toHaveLength(10);
  });

  it("applies to every match, and reports a thread that failed while the rest still change", async () => {
    const modifyThread = vi.fn(async (id: string) => {
      if (id === "t2") throw new Error("boom");
      return {};
    });
    const deps = depsWith({ gmail: gmailStub({ labels, listThreads: pagedThreads(5, 500) }), write: writeStub({ modifyThread }) });
    const out = await modifyLabelsMatching(deps, { query: "q", add: ["Newsletters"], remove: ["INBOX"], apply: true, limit: 10 });
    expect(modifyThread).toHaveBeenCalledTimes(5);
    expect(modifyThread).toHaveBeenCalledWith("t0", { add: ["Label_3"], remove: ["INBOX"] });
    expect(out).toMatchObject({ dryRun: false, matched: 5, modified: 4, failed: [{ id: "t2", reason: "boom" }] });
  });

  it("gives a thread Gmail throttled a second pass before calling it failed", async () => {
    const tries = new Map<string, number>();
    const modifyThread = vi.fn(async (id: string) => {
      tries.set(id, (tries.get(id) ?? 0) + 1);
      if (id === "t1" && tries.get(id) === 1) fail(quotaError("slow down"));
      return {};
    });
    const deps = depsWith({ gmail: gmailStub({ labels, listThreads: pagedThreads(3, 500) }), write: writeStub({ modifyThread }) });
    const out = await modifyLabelsMatching(deps, { query: "q", add: [], remove: ["UNREAD"], apply: true, limit: 10 });
    expect(out).toMatchObject({ modified: 3 });
    expect(out).not.toHaveProperty("failed");
    expect(tries.get("t1")).toBe(2);
  });

  it("refuses to apply when the query matches more than the limit, before changing anything", async () => {
    const modifyThread = vi.fn(async () => ({}));
    const deps = depsWith({ gmail: gmailStub({ labels, listThreads: pagedThreads(20, 500) }), write: writeStub({ modifyThread }) });
    const err = await errorOf(modifyLabelsMatching(deps, { query: "q", add: [], remove: ["UNREAD"], apply: true, limit: 10 }));
    expect(err).toMatchObject({ kind: "input" });
    expect(modifyThread).not.toHaveBeenCalled();
  });

  it("refuses an empty query, an unknown label and an empty change", async () => {
    const deps = depsWith({ gmail: gmailStub({ labels }) });
    expect(await errorOf(modifyLabelsMatching(deps, { query: " ", add: ["Newsletters"], remove: [], apply: false, limit: 10 }))).toMatchObject({ kind: "input" });
    expect(await errorOf(modifyLabelsMatching(deps, { query: "q", add: ["Nope"], remove: [], apply: false, limit: 10 }))).toMatchObject({ kind: "input" });
    expect(await errorOf(modifyLabelsMatching(deps, { query: "q", add: [], remove: [], apply: false, limit: 10 }))).toMatchObject({ kind: "input" });
  });

  it("refuses on the read-only grant, dry run included", async () => {
    const ro = grantStub("readonly", "https://www.googleapis.com/auth/gmail.readonly");
    const err = await errorOf(modifyLabelsMatching(depsWith({ grant: ro, grants: [ro] }), { query: "q", add: ["INBOX"], remove: [], apply: false, limit: 1 }));
    expect(err).toMatchObject({ kind: "auth", code: "readonly_grant" });
  });
});

describe("the sender of a thread", () => {
  it("is the latest author the mailbox did not send, and the thread is unread if any message is", () => {
    const thread = {
      messages: [
        message('"Ana Pop" <Ana@Acme.example>', ["INBOX", "UNREAD"], "1700000000000"),
        message("Me <me@example.com>", ["SENT"], "1700000100000"),
      ],
    };
    expect(threadSender(thread)).toEqual({ email: "ana@acme.example", name: "Ana Pop", unread: true, at: 1700000100000 });
  });

  it("falls back to the last message on a thread the mailbox only sent", () => {
    expect(threadSender({ messages: [message("me@example.com", ["SENT"], "5")] })).toMatchObject({ email: "me@example.com", unread: false });
  });
});

describe("breakdown", () => {
  it("groups by domain, busiest first, and sums what it does not list", () => {
    const s = (email: string, unread: boolean, at: number) => ({ email, name: undefined, unread, at });
    const out = breakdown(
      [s("a@jobs.example", true, Date.UTC(2026, 0, 1)), s("b@jobs.example", false, Date.UTC(2024, 5, 1)), s("a@jobs.example", true, Date.UTC(2025, 0, 1)), s("x@bank.example", false, 0), s("y@other.example", true, 1)],
      2,
    );
    expect(out).toMatchObject({ threads: 5, unread: 3, domainCount: 3, addressCount: 4, otherDomains: { domains: 1, threads: 1 } });
    expect(out.domains[0]).toMatchObject({
      domain: "jobs.example",
      threads: 3,
      unread: 2,
      newest: "2026-01-01",
      oldest: "2024-06-01",
      addresses: [{ email: "a@jobs.example", threads: 2, unread: 2 }, { email: "b@jobs.example", threads: 1 }],
    });
  });
});

describe("senderBreakdown", () => {
  it("reads only the From header and the labels, and counts what it could not read", async () => {
    const getThreads = vi.fn(async (ids: readonly string[]) =>
      ids.map((id) => (id === "t1" ? { ok: false as const, reason: "notFound" } : { ok: true as const, value: { messages: [message("n@jobs.example", ["UNREAD"], "1")] } })),
    );
    const deps = depsWith({ gmail: gmailStub({ listThreads: pagedThreads(3, 500), getThreads }) });
    const out = await senderBreakdown(deps, { query: "in:inbox", limit: 100, top: 10 });
    expect(getThreads).toHaveBeenCalledWith(["t0", "t1", "t2"], { format: "metadata", metadataHeaders: ["From"], concurrency: 16 });
    expect(out).toMatchObject({ scanned: 3, more: false, unreadable: 1, threads: 2, unread: 2, domains: [{ domain: "jobs.example", threads: 2 }] });
  });
});

describe("filters", () => {
  it("render as the search Gmail would run for them", () => {
    expect(queryOf({ from: "jobs.example.com", subject: "new jobs", negatedQuery: "urgent", hasAttachment: true })).toBe(
      "from:jobs.example.com subject:(new jobs) -{urgent} has:attachment",
    );
  });

  it("need a criterion and an action", () => {
    expect(() => filterSpec({ from: "  " }, { add: ["L"], remove: [] })).toThrow();
    expect(() => filterSpec({ from: "a@b.c" }, { add: [], remove: [] })).toThrow();
    expect(filterSpec({ from: " a@b.c " }, { add: [], remove: ["INBOX"] })).toEqual({ criteria: { from: "a@b.c" }, action: { addLabelIds: [], removeLabelIds: ["INBOX"] } });
  });

  it("read back with label names and a forward made elsewhere", () => {
    const view = filterView(
      { id: "F9", criteria: { from: "bank.example", size: 1000, sizeComparison: "larger" }, action: { addLabelIds: ["Label_3"], removeLabelIds: ["INBOX"], forward: "x@y.z" } },
      [{ id: "Label_3", name: "Newsletters" }, { id: "INBOX", name: "INBOX" }],
    );
    expect(view).toEqual({
      id: "F9",
      criteria: { from: "bank.example", size: 1000, sizeComparison: "larger" },
      add: ["Newsletters"],
      remove: ["INBOX"],
      query: "from:bank.example larger:1000",
      forward: "x@y.z",
    });
  });

  it("are refused, before any request, on a grant without gmail.settings.basic", async () => {
    const createFilterCall = vi.fn();
    const deps = depsWith({ gmail: gmailStub({ labels }), write: writeStub({ createFilter: createFilterCall }) });
    const err = await errorOf(createFilter(deps, { criteria: { from: "x.com" }, add: ["Newsletters"], remove: ["INBOX"] }));
    expect(err).toMatchObject({ kind: "auth", code: "insufficient_scope" });
    expect(createFilterCall).not.toHaveBeenCalled();
    expect(await errorOf(deleteFilter(deps, "F1"))).toMatchObject({ kind: "auth", code: "insufficient_scope" });
  });

  it("are created with label names resolved, on a grant that carries the scope", async () => {
    const grant = grantStub("modify", `${MODIFY} ${SETTINGS}`);
    const createFilterCall = vi.fn(writeStub().createFilter);
    const deps = depsWith({ grant, grants: [grant], gmail: gmailStub({ labels }), write: writeStub({ createFilter: createFilterCall }) });
    const out = await createFilter(deps, { criteria: { from: "news.example.com" }, add: ["newsletters"], remove: ["inbox"] });
    expect(createFilterCall).toHaveBeenCalledWith({ criteria: { from: "news.example.com" }, action: { addLabelIds: ["Label_3"], removeLabelIds: ["INBOX"] } });
    expect(out.filter).toMatchObject({ add: ["Newsletters"], remove: ["INBOX"], query: "from:news.example.com" });
  });

  it("refuse to send arriving mail to TRASH or SPAM unless told discard", async () => {
    const grant = grantStub("modify", `${MODIFY} ${SETTINGS}`);
    const createFilterCall = vi.fn(writeStub().createFilter);
    const withTrash = async () => ({ labels: [...(await labels()).labels, { id: "TRASH", name: "TRASH", type: "system" }] });
    const deps = depsWith({ grant, grants: [grant], gmail: gmailStub({ labels: withTrash }), write: writeStub({ createFilter: createFilterCall }) });
    expect(await errorOf(createFilter(deps, { criteria: { from: "x.example" }, add: ["TRASH"], remove: [] }))).toMatchObject({ kind: "input", message: expect.stringMatching(/discard: true/) });
    expect(createFilterCall).not.toHaveBeenCalled();
    await createFilter(deps, { criteria: { from: "x.example" }, add: ["TRASH"], remove: [], discard: true });
    expect(createFilterCall).toHaveBeenCalled();
  });

  it("list on the plain modify grant", async () => {
    const deps = depsWith({ gmail: gmailStub({ labels, filters: async () => ({ filter: [{ id: "F1", criteria: { from: "a.example" }, action: { addLabelIds: ["Label_3"] } }] }) }) });
    expect(await listFilters(deps)).toMatchObject({ filters: [{ id: "F1", add: ["Newsletters"], query: "from:a.example" }] });
  });
});

describe("trash", () => {
  it("says which ids were trashed and which failed, rather than failing them all", async () => {
    const write = writeStub({ trash: async (_t: string, id: string) => (id === "bad" ? fail(quotaError("slow down")) : undefined) });
    const out = await trash(depsWith({ write }), { target: "thread", ids: ["a", "bad", "b"] });
    expect(out).toMatchObject({ trashed: ["a", "b"], failed: [{ id: "bad", error: expect.stringMatching(/slow down/) }] });
    expect(await errorOf(trash(depsWith({ write }), { target: "thread", ids: ["bad"] }))).toMatchObject({ kind: "quota" });
  });
});
