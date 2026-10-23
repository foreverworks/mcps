/** Bulk attachment harvest, against a fake mailbox. */
import { asGuardError, inCall } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import type { Deps, GmailPort } from "../../src/gmail/app/ports.js";
import type { MimePart } from "../../src/gmail/domain/mime.js";
import { harvestAttachments } from "../../src/gmail/app/usecases/harvest.js";
import { grantExtras } from "./fakes.js";

const part = (filename: string, attachmentId: string, size = 10) => ({
  filename,
  mimeType: "application/pdf",
  body: { attachmentId, size },
});

const message = (id: string, subject: string, parts: readonly MimePart[]) => ({
  id,
  payload: { headers: [{ name: "Subject", value: subject }, { name: "Date", value: "Mon, 01 Sep 2026 10:00:00 +0000" }], parts },
});

const deps = (over: Partial<GmailPort> = {}, written: string[] = []): Deps & { written: string[] } => ({
  account: "work",
  gmail: {
    profile: async () => ({}),
    tokenInfo: async () => ({}),
    labels: async () => ({}),
    filters: async () => ({}),
    listThreads: async () => ({ threads: [{ id: "t1" }] }),
    getThread: async () => ({}),
    getThreads: async () => [
      {
        ok: true as const,
        value: {
          id: "t1",
          messages: [
            message("m1", "August invoice", [part("invoice.pdf", "a1"), part("logo.png", "a2")]),
            // An inline part carries an attachmentId but no filename. Counting
            // it would report every newsletter as having an attachment.
            message("m2", "Newsletter", [{ mimeType: "text/html", body: { attachmentId: "a3", size: 9000 } }]),
          ],
        },
      },
    ],
    getMessage: async () => ({}),
    getMessages: async () => [],
    getAttachment: async () => Buffer.from("PDFBYTES"),
    listHistory: async () => ({}),
    ...over,
  },
  files: {
    readInput: async () => Promise.reject(new Error("no files here")),
    writeFile: async (dir, name) => {
      written.push(`${dir}/${name}`);
      return `${dir}/${name}`;
    },
  },
  htmlToText: (h) => h,
  paths: { stateDir: "/s", attachmentsDir: "/s/a" },
  ...grantExtras(),
  written,
});

describe("harvestAttachments", () => {
  it("saves real attachments, skips inline parts, and prefixes the message id so two invoice.pdf cannot collide", async () => {
    const d = deps();
    const out = await harvestAttachments(d, { query: "has:attachment", maxThreads: 10, maxAttachments: 100 });

    expect(out.savedCount).toBe(2);
    expect(out.attachmentsFound).toBe(2);
    expect(d.written).toEqual(["/s/a/m1-invoice.pdf", "/s/a/m1-logo.png"]);
    expect(out.bytesTotal).toBe(16);
  });

  it("filters by extension when asked", async () => {
    const d = deps();
    const out = await harvestAttachments(d, {
      query: "has:attachment",
      maxThreads: 10,
      maxAttachments: 100,
      extensions: ["pdf"],
    });
    expect(out.saved.map((s) => s.filename)).toEqual(["invoice.pdf"]);
  });

  /**
   * The reconciliation contract. A harvest that quietly stops at the cap looks
   * exactly like a complete one, which is how a month of accounting ends up
   * short a document and nobody notices.
   */
  it("says so when the cap truncated the result", async () => {
    const out = await harvestAttachments(deps(), { query: "", maxThreads: 10, maxAttachments: 1 });
    expect(out.truncated).toBe(true);
    expect(out.savedCount).toBe(1);
    expect(out.attachmentsFound).toBe(2);
  });

  it("lists a failed file instead of aborting the whole harvest", async () => {
    let call = 0;
    const d = deps({
      getAttachment: async () => {
        call += 1;
        if (call === 1) throw new Error("404 attachment not found");
        return Buffer.from("OK");
      },
    });
    const out = await harvestAttachments(d, { query: "", maxThreads: 10, maxAttachments: 100 });

    expect(out.failedCount).toBe(1);
    expect(out.savedCount).toBe(1);
    expect(out.failed[0]?.reason).toMatch(/404/);
  });

  it("reports a thread it could not read rather than counting it as empty", async () => {
    const d = deps({ getThreads: async () => [{ ok: false as const, reason: "500 from Google" }] });
    const out = await harvestAttachments(d, { query: "", maxThreads: 10, maxAttachments: 100 });

    expect(out.unreadableThreads).toEqual([{ threadId: "t1", reason: "500 from Google" }]);
    expect(out.attachmentsFound).toBe(0);
  });
});

describe("harvestAttachments, as a long call", () => {
  it("tells a client that asked how many attachments are saved, out of how many", async () => {
    const heard: unknown[] = [];
    await inCall({ progress: (progress, total, message) => void heard.push({ progress, total, message }) }, () =>
      harvestAttachments(deps(), { query: "has:attachment", maxThreads: 10, maxAttachments: 100 }),
    );
    expect(heard).toEqual([
      { progress: 0, total: 2, message: "2 attachments to save from 1 thread" },
      { progress: 1, total: 2, message: "1 of 2 attachments" },
      { progress: 2, total: 2, message: "2 of 2 attachments" },
    ]);
  });

  it("ends as cancelled when the client cancels, never as a manifest that looks complete", async () => {
    const controller = new AbortController();
    const d = deps({
      getAttachment: async () => {
        controller.abort();
        throw new Error("This operation was aborted");
      },
    });
    const thrown = await inCall({ signal: controller.signal }, () => harvestAttachments(d, { query: "has:attachment", maxThreads: 10, maxAttachments: 100 })).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(asGuardError(thrown)).toMatchObject({ kind: "cancelled", message: expect.stringContaining("not saved") });
    expect(d.written).toEqual([]);
  });
});
