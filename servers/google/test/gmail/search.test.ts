/** Cross-account search, against fake mailboxes. */
import { describe, expect, it } from "vitest";

import type { Deps, GmailPort } from "../../src/gmail/app/ports.js";
import { searchAccounts } from "../../src/gmail/app/usecases/search.js";
import { grantExtras } from "./fakes.js";

const header = (name: string, value: string) => ({ name, value });

const mailbox = (account: string, threads: readonly { id: string; date: string }[], over: Partial<GmailPort> = {}): Deps => {
  const gmail: GmailPort = {
    profile: async () => ({}),
    tokenInfo: async () => ({}),
    labels: async () => ({}),
    filters: async () => ({}),
    listThreads: async () => ({ threads: threads.map((t) => ({ id: t.id })), nextPageToken: `${account}-next` }),
    getThread: async () => ({}),
    getThreads: async (ids) =>
      ids.map((id) => {
        const match = threads.find((t) => t.id === id);
        return {
          ok: true as const,
          value: { id, messages: [{ id, payload: { headers: [header("Date", match?.date ?? "")] } }] },
        };
      }),
    getMessage: async () => ({}),
    getMessages: async () => [],
    getAttachment: async () => Buffer.alloc(0),
    listHistory: async () => ({}),
    ...over,
  };
  return {
    account,
    gmail,
    files: { writeFile: async () => "/tmp/x", readInput: async () => Promise.reject(new Error("no files here")) },
    htmlToText: (h) => h,
    paths: { stateDir: "/s", attachmentsDir: "/s/a" },
    ...grantExtras(),
  };
};

describe("searchAccounts", () => {
  it("tags every result with its mailbox and interleaves them newest first", async () => {
    const personal = mailbox("personal", [{ id: "p1", date: "Mon, 01 Sep 2026 10:00:00 +0000" }]);
    const work = mailbox("work", [
      { id: "w1", date: "Tue, 02 Sep 2026 10:00:00 +0000" },
      { id: "w2", date: "Sun, 31 Aug 2026 10:00:00 +0000" },
    ]);

    const out = await searchAccounts([personal, work], { maxResults: 10 });

    // A thread id means nothing without the mailbox it came from — Gmail ids
    // are per-account, so an untagged merged list is unusable.
    expect(out.threads.map((t) => `${t.account}:${t.id}`)).toEqual(["work:w1", "personal:p1", "work:w2"]);
  });

  it("keeps page tokens per account, because Gmail's are per mailbox", async () => {
    const out = await searchAccounts(
      [mailbox("personal", [{ id: "p1", date: "Mon, 01 Sep 2026 10:00:00 +0000" }]), mailbox("work", [])],
      { maxResults: 10 },
    );
    expect(out.accounts).toEqual([
      { account: "personal", nextPageToken: "personal-next" },
      { account: "work", nextPageToken: "work-next" },
    ]);
  });

  /**
   * The rule that makes a two-mailbox search worth having: a dead grant on one
   * account reports itself and the other account still answers. Throwing here
   * would turn a partial answer into no answer.
   */
  it("reports a failing mailbox and still returns the other one's results", async () => {
    const broken = mailbox("work", [], {
      listThreads: async () => {
        throw new Error("invalid_grant: token has been expired or revoked");
      },
    });
    const out = await searchAccounts([mailbox("personal", [{ id: "p1", date: "Mon, 01 Sep 2026 10:00:00 +0000" }]), broken], {
      maxResults: 10,
    });

    expect(out.threads.map((t) => t.id)).toEqual(["p1"]);
    expect(out.accounts.find((a) => a.account === "work")?.error).toMatch(/invalid_grant/);
  });

  it("sorts a thread whose summary could not be fetched last rather than dropping it", async () => {
    const flaky = mailbox("work", [{ id: "w1", date: "" }], {
      getThreads: async (ids) => ids.map(() => ({ ok: false as const, reason: "500 from Google" })),
    });
    const out = await searchAccounts([flaky, mailbox("personal", [{ id: "p1", date: "Mon, 01 Sep 2026 10:00:00 +0000" }])], {
      maxResults: 10,
    });
    expect(out.threads.map((t) => t.id)).toEqual(["p1", "w1"]);
  });
});
