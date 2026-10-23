/**
 * Use cases against a FAKE GmailPort. No network, no credentials, no HTTP.
 *
 * This is what the ports buy: the rules below are the ones that matter in
 * production, and none of them needs a Google account to prove.
 */
import { describe, expect, it, vi } from "vitest";

import { authError, describeThrown, fail } from "../../src/gmail/domain/errors.js";

import type { Deps, FilePort, GmailPort } from "../../src/gmail/app/ports.js";
import { saveAttachment } from "../../src/gmail/app/usecases/attachments.js";
import { listHistory } from "../../src/gmail/app/usecases/history.js";
import { readMessages, readThread, searchThreads } from "../../src/gmail/app/usecases/threads.js";
import { grantExtras } from "./fakes.js";

const gmailStub = (over: Partial<GmailPort> = {}): GmailPort => ({
  profile: async () => ({}),
  tokenInfo: async () => ({}),
  labels: async () => ({}),
  filters: async () => ({}),
  listThreads: async () => ({}),
  getThread: async () => ({}),
  getThreads: async () => [],
  getMessage: async () => ({}),
  getMessages: async () => [],
  getAttachment: async () => Buffer.alloc(0),
  listHistory: async () => ({}),
  ...over,
});

const deps = (gmail: GmailPort, files: Pick<FilePort, "writeFile"> = { writeFile: async () => "/tmp/x" }): Deps => ({
  account: "personal",
  gmail,
  files: { readInput: async () => Promise.reject(new Error("no files here")), ...files },
  htmlToText: (h) => h,
  paths: { stateDir: "/s", attachmentsDir: "/s/attachments" },
  ...grantExtras(),
});

describe("readMessages", () => {
  const subject = (id: string, text: string) => ({ id, threadId: `t-${id}`, payload: { headers: [{ name: "Subject", value: text }] } });

  it("reads each id once, in the order asked, with the cheap format for metadata", async () => {
    const getMessages = vi.fn(async (ids: readonly string[]) => ids.map((id) => ({ ok: true as const, value: subject(id, `S ${id}`) })));
    const out = await readMessages(deps(gmailStub({ getMessages })), ["m2", " m1 ", "m2", ""], "metadata");
    expect(getMessages).toHaveBeenCalledWith(["m2", "m1"], expect.objectContaining({ format: "metadata" }));
    expect(out.messages.map((m) => m.id)).toEqual(["m2", "m1"]);
    expect(out).not.toHaveProperty("unreadable");
  });

  it("keeps an unreadable message in its place and counts it, so the others still arrive", async () => {
    const out = await readMessages(
      deps(
        gmailStub({
          getMessages: async () => [
            { ok: true, value: subject("a", "A") },
            { ok: false, reason: "notFound" },
          ],
        }),
      ),
      ["a", "gone"],
      "text",
    );
    expect(out.messages[1]).toEqual({ id: "gone", partial: true, reason: "notFound" });
    expect(out.unreadable).toBe(1);
  });
});

describe("searchThreads", () => {
  const stubs = [
    { id: "a", snippet: "sa" },
    { id: "bad", snippet: "sb" },
    { id: "c", snippet: "sc" },
  ];

  it("degrades ONE unreadable thread instead of losing the result set", async () => {
    const out = await searchThreads(
      deps(
        gmailStub({
          listThreads: async () => ({ threads: stubs, nextPageToken: "n" }),
          getThreads: async () => [
            { ok: true, value: { messages: [{ payload: { headers: [{ name: "Subject", value: "A" }] } }] } },
            { ok: false, reason: "notFound" },
            { ok: true, value: { messages: [{ payload: { headers: [{ name: "Subject", value: "C" }] } }] } },
          ],
        }),
      ),
      { maxResults: 20 },
    );

    expect(out.threads).toHaveLength(3);
    expect(out.threads[0]).toMatchObject({ id: "a", subject: "A" });
    expect(out.threads[1]).toMatchObject({ id: "bad", partial: true, reason: "notFound" });
    expect(out.threads[2]).toMatchObject({ id: "c", subject: "C" });
    expect(out.nextPageToken).toBe("n");
  });

  it("asks for only the headers a summary reads", async () => {
    const getThreads = vi.fn(async () => []);
    await searchThreads(
      deps(gmailStub({ listThreads: async () => ({ threads: [{ id: "a" }] }), getThreads })),
      { maxResults: 5 },
    );
    expect(getThreads).toHaveBeenCalledWith(["a"], {
      format: "metadata",
      metadataHeaders: ["From", "To", "Cc", "Subject", "Date"],
    });
  });

  it("keeps the list stub's snippet when the metadata fetch has none", async () => {
    const out = await searchThreads(
      deps(
        gmailStub({
          listThreads: async () => ({ threads: [{ id: "a", snippet: "from the stub" }] }),
          getThreads: async () => [{ ok: true, value: { messages: [] } }],
        }),
      ),
      { maxResults: 5 },
    );
    expect(out.threads[0]).toMatchObject({ snippet: "from the stub" });
  });
});

describe("readThread", () => {
  it("fetches the CHEAP format when no body was asked for", async () => {
    const getThread = vi.fn(async () => ({}));
    await readThread(deps(gmailStub({ getThread })), "t1", "metadata");
    expect(getThread).toHaveBeenCalledWith("t1", {
      format: "metadata",
      metadataHeaders: ["From", "To", "Cc", "Subject", "Date", "Message-ID", "Reply-To"],
    });
  });

  it("fetches the full format when bodies are wanted", async () => {
    const getThread = vi.fn(async () => ({}));
    await readThread(deps(gmailStub({ getThread })), "t1", "text");
    expect(getThread).toHaveBeenCalledWith("t1", { format: "full" });
  });
});

describe("listHistory", () => {
  it("flattens messagesAdded across history entries and drops empty ones", async () => {
    const out = await listHistory(
      deps(
        gmailStub({
          listHistory: async () => ({
            history: [
              { messagesAdded: [{ message: { id: "m1", threadId: "t1" } }] },
              { messagesAdded: [{}] },
              { messagesAdded: [{ message: { id: "m2", threadId: "t2", labelIds: ["INBOX"] } }] },
              {},
            ],
            historyId: "99",
          }),
        }),
      ),
      { startHistoryId: "1", maxResults: 100 },
    );
    expect(out.messagesAdded).toEqual([
      { id: "m1", threadId: "t1", labelIds: [] },
      { id: "m2", threadId: "t2", labelIds: ["INBOX"] },
    ]);
    expect(out.historyId).toBe("99");
  });
});

describe("saveAttachment", () => {
  it("strips path separators out of a caller-supplied filename", async () => {
    const writeFile = vi.fn(async (_d: string, n: string) => `/s/attachments/${n}`);
    await saveAttachment(
      deps(gmailStub({ getAttachment: async () => Buffer.from("pdf") }), { writeFile }),
      { messageId: "m", attachmentId: "a", filename: "../../etc/passwd" },
    );
    expect(writeFile).toHaveBeenCalledWith("/s/attachments", "passwd", expect.any(Buffer));
  });

  it("falls back to the state dir and an id-derived name", async () => {
    const writeFile = vi.fn(async (_d: string, n: string) => `/s/attachments/${n}`);
    const out = await saveAttachment(
      deps(gmailStub({ getAttachment: async () => Buffer.from("1234") }), { writeFile }),
      { messageId: "m", attachmentId: "abcdef" },
    );
    expect(writeFile).toHaveBeenCalledWith("/s/attachments", "abcdef.bin", expect.any(Buffer));
    expect(out.bytes).toBe(4);
  });
});

describe("degrade paths report what actually failed", () => {
  it("names a tagged failure instead of [object Object]", async () => {
    // Our failures are tagged plain objects, not Errors. `instanceof Error`
    // missed every one of them, so a revoked grant on one mailbox was reported
    // as "[object Object]" - the exact case per-account reporting exists for.
    const revoked = (() => {
      try {
        return fail(authError("invalid_grant", "token has been expired or revoked"));
      } catch (thrown) {
        return thrown;
      }
    })();
    const described = describeThrown(revoked);
    expect(described).not.toContain("[object Object]");
    expect(described).toContain("invalid_grant");
    expect(described).toContain("begin_consent");
  });

  it("still describes an ordinary Error and a bare throw", () => {
    expect(describeThrown(new Error("socket hang up"))).toBe("socket hang up");
    expect(describeThrown("nope")).toBe("nope");
  });
});
