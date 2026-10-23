import { describe, expect, it } from "vitest";

import { messageView, threadSummary } from "../../src/gmail/domain/summaries.js";

const noop = (h: string) => h;

describe("messageView", () => {
  const msg = {
    id: "m1",
    payload: {
      headers: [
        { name: "Subject", value: "Invoice" },
        { name: "From", value: "a@b.c" },
      ],
      parts: [{ mimeType: "text/plain", body: { data: Buffer.from("secret").toString("base64url") } }],
    },
  };

  it("carries neither body NOR attachments at metadata detail", () => {
    const out = messageView(msg, "metadata", noop);
    expect(out.subject).toBe("Invoice");
    expect("body" in out).toBe(false);
    expect("bodySource" in out).toBe(false);
    // format=metadata returns no MIME tree, so an attachment list built from it
    // would be permanently empty. A key that is always [] reads as an answer.
    expect("attachments" in out).toBe(false);
  });

  it("carries the attachment list at text detail", () => {
    const withPdf = {
      payload: { headers: [], parts: [{ filename: "a.pdf", body: { attachmentId: "x", size: 9 } }] },
    };
    expect(messageView(withPdf, "text", noop).attachments).toHaveLength(1);
  });

  it.each(["metadata", "text", "raw_html"] as const)("retains cross-mailbox identity and reply routing at %s detail", (detail) => {
    const out = messageView({
      id: "mailbox-local-id",
      payload: { headers: [
        { name: "Message-Id", value: "<CaseSensitive-ID@example.test>" },
        { name: "reply-to", value: "Recruiting <careers@example.test>" },
        { name: "from", value: "ATS <noreply@ats.example.test>" },
      ] },
    }, detail, noop);
    expect(out).toMatchObject({
      id: "mailbox-local-id", messageId: "<CaseSensitive-ID@example.test>",
      replyTo: "Recruiting <careers@example.test>", from: "ATS <noreply@ats.example.test>",
    });
  });

  it("does not invent identity or reply headers a message lacks", () => {
    const out = JSON.parse(JSON.stringify(messageView(msg, "metadata", noop)));
    expect(out).not.toHaveProperty("messageId");
    expect(out).not.toHaveProperty("replyTo");
  });

  it("carries the body and its provenance at text detail", () => {
    const out = messageView(msg, "text", noop);
    expect([out.body, out.bodySource]).toEqual(["secret", "plain"]);
  });
});

describe("threadSummary", () => {
  it("reads the LAST message, and claims nothing about attachments", () => {
    const thread = {
      snippet: "s",
      messages: [
        { payload: { headers: [{ name: "Subject", value: "old" }] } },
        {
          payload: {
            headers: [
              { name: "Subject", value: "new" },
              { name: "From", value: "a@b.c" },
            ],
            parts: [{ filename: "x.pdf", body: { attachmentId: "z" } }],
          },
        },
      ],
    };
    const out = threadSummary(thread, "t1");
    expect([out.subject, out.lastFrom, out.messageCount]).toEqual(["new", "a@b.c", 2]);
    // format=metadata never returns `parts`, so a summary must not pretend.
    expect("hasAttachments" in out).toBe(false);
  });

  it("survives an empty thread", () => {
    expect(threadSummary({}, "t9")).toMatchObject({ id: "t9", messageCount: 0 });
  });
});
