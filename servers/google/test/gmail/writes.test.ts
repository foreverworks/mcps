/**
 * The write use cases against fake ports. What is proved here is what must
 * never regress in production: a write on a read-only grant never reaches
 * Gmail, replies thread, drafts stay drafts, and an edit keeps what it was not
 * asked to change.
 */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { asInputFileError, inputFilesWith } from "@foreverworks/mcp-kit";
import { describe, expect, it, vi } from "vitest";

import { createDraft, sendDraft, updateDraft } from "../../src/gmail/app/usecases/drafts.js";
import { modifyLabels } from "../../src/gmail/app/usecases/organize.js";
import { forward, reply, sendMessage } from "../../src/gmail/app/usecases/reply.js";
import { asAppError } from "../../src/gmail/domain/errors.js";
import { htmlToText } from "../../src/gmail/infra/htmlText.js";
import type { RawMessage } from "../../src/gmail/domain/summaries.js";
import { depsWith, gmailStub, grantStub, MODIFY, READONLY, writeStub } from "./fakes.js";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

/** The decoded text/plain body of a raw message, for asserting on what a recipient reads. */
const textOf = (raw: string): string => {
  const at = raw.indexOf('Content-Type: text/plain; charset="UTF-8"');
  const body = raw.slice(raw.indexOf("\r\n\r\n", at) + 4).split(/\r\n(?:--|\r\n)/)[0] as string;
  return Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8").replace(/\r\n/g, "\n");
};

/** The decoded text/html body of a raw message, or undefined when it has none. */
const htmlOf = (raw: string): string | undefined => {
  const at = raw.indexOf('Content-Type: text/html; charset="UTF-8"');
  if (at < 0) return undefined;
  const body = raw.slice(raw.indexOf("\r\n\r\n", at) + 4).split(/\r\n(?:--|\r\n)/)[0] as string;
  return Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8").replace(/\r\n/g, "\n");
};

const headersOfRaw = (raw: string) => raw.slice(0, raw.indexOf("\r\n\r\n")).replace(/\r\n /g, " ");

const errorOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (thrown) {
    return asAppError(thrown);
  }
  throw new Error("expected a failure");
};

/** A follow-up the user sent to a recruiter, as Gmail returns it. */
const sentByMe: RawMessage = {
  id: "18c0000000000002",
  threadId: "18c0000000000001",
  payload: {
    mimeType: "multipart/mixed",
    headers: [
      { name: "From", value: "Ana Popescu <ana.popescu@example.com>" },
      { name: "To", value: "Maria Ionescu <maria.ionescu@recruiter.example>" },
      { name: "Subject", value: "Re: Example project" },
      { name: "Message-ID", value: "<CAmine@mail.example.com>" },
      { name: "In-Reply-To", value: "<first@recruiter.example>" },
      { name: "References", value: "<first@recruiter.example>" },
      { name: "Date", value: "Mon, 17 Aug 2026 02:10:00 +0300" },
    ],
    parts: [
      { mimeType: "text/plain", body: { data: b64("Hi Maria,\nInterested, CV attached.\n") } },
      { mimeType: "application/pdf", filename: "Ana_Popescu_resume.pdf", body: { attachmentId: "att-1", size: 8 } },
      { mimeType: "text/plain", filename: "note.txt", body: { data: b64("inline small file") } },
    ],
  },
};

const personal = (over: Parameters<typeof depsWith>[0] = {}) =>
  depsWith({
    address: "ana.popescu@example.com",
    gmail: gmailStub({
      getMessage: async () => sentByMe,
      getAttachment: async () => Buffer.from("%PDF-1.7"),
    }),
    write: writeStub({
      sendAs: async () => ({ sendAs: [{ sendAsEmail: "ana.popescu@example.com", isPrimary: true, isDefault: true, displayName: "" }] }),
    }),
    ...over,
  });

describe("the write guard", () => {
  it("refuses every write on the read-only grant, before any request reaches Gmail", async () => {
    const write = writeStub({ createDraft: vi.fn(), sendAs: vi.fn() });
    const ro = grantStub("readonly", READONLY);
    const deps = depsWith({ grant: ro, grants: [ro], write, modifyPath: "/cfg/gmail/modify/personal/credentials.json" });
    const err = await errorOf(createDraft(deps, { to: ["a@example.com"], subject: "x" }));
    expect(err).toMatchObject({ kind: "auth", code: "readonly_grant", permanent: true });
    expect(err?.message).toContain("/cfg/gmail/modify/personal/credentials.json");
    expect(write.createDraft).not.toHaveBeenCalled();
    expect(write.sendAs).not.toHaveBeenCalled();
  });

  it("refuses when the server's own grant came back without gmail.modify", async () => {
    const thin = grantStub("modify", READONLY);
    const err = await errorOf(sendMessage(depsWith({ grant: thin, grants: [thin] }), { to: ["a@example.com"] }));
    expect(err).toMatchObject({ code: "insufficient_scope" });
  });
});

describe("reply", () => {
  it("drafts by default, threaded: threadId, In-Reply-To, References, Re: once, To from the sent message", async () => {
    const createDraft = vi.fn(async (_raw: string, threadId?: string) => ({ id: "r-42", message: { id: "d1", threadId: threadId as string } }));
    const sendMessage = vi.fn();
    const deps = personal({ write: { ...personal().write, createDraft, sendMessage } });
    const out = await reply(deps, { messageId: sentByMe.id as string, replyAll: false, quote: false, send: false, bodyText: "Following up." });

    expect(sendMessage).not.toHaveBeenCalled();
    const [raw, threadId] = createDraft.mock.calls[0] as [string, string];
    expect(threadId).toBe("18c0000000000001");
    const h = headersOfRaw(raw);
    expect(h).toContain("To: Maria Ionescu <maria.ionescu@recruiter.example>");
    expect(h).toContain("Subject: Re: Example project");
    expect(h).not.toContain("Re: Re:");
    expect(h).toContain("In-Reply-To: <CAmine@mail.example.com>");
    expect(h).toContain("References: <first@recruiter.example> <CAmine@mail.example.com>");
    expect(h).not.toMatch(/^From:/m);
    expect(textOf(raw)).toBe("Following up.");
    expect(out).toMatchObject({ sent: false, draftId: "r-42", threadId: "18c0000000000001" });
    expect(out.webUrl).toBe(
      "https://mail.google.com/mail/?authuser=ana.popescu@example.com#all/thread-f:1783425452438716417",
    );
  });

  it("quotes the original under the reply, Gmail-style, when asked", async () => {
    const createDraft = vi.fn(async (_raw: string, _threadId?: string) => ({ id: "r-1", message: { id: "d", threadId: "t" } }));
    await reply(personal({ write: { ...personal().write, createDraft } }), {
      messageId: "m",
      replyAll: false,
      quote: true,
      send: false,
      bodyText: "Thanks.",
    });
    const text = textOf(createDraft.mock.calls[0]?.[0] as string);
    expect(text).toContain("Thanks.\n\nOn Mon, Aug 17, 2026 at 2:10\u202fAM Ana Popescu <ana.popescu@example.com> wrote:\n\n> Hi Maria,");
  });

  it("gives a text-only body an HTML twin, so Gmail does not rewrap it to fixed-width lines on Send", async () => {
    const createDraft = vi.fn(async (_raw: string, _threadId?: string) => ({ id: "r-1", message: { id: "d", threadId: "t" } }));
    const body = "Bună ziua,\n\nAm o întrebare despre comanda nr. 1234567, plătită online.\n\nVă mulțumesc,\nAna";
    await reply(personal({ write: { ...personal().write, createDraft } }), { messageId: "m", replyAll: false, quote: false, send: false, bodyText: body });
    const raw = createDraft.mock.calls[0]?.[0] as string;
    expect(raw).toContain("Content-Type: multipart/alternative");
    expect(textOf(raw)).toBe(body);
    expect(htmlOf(raw)).toBe(
      '<div dir="ltr">Bună ziua,<br>\n<br>\nAm o întrebare despre comanda nr. 1234567, plătită online.<br>\n<br>\nVă mulțumesc,<br>\nAna</div>',
    );
  });

  it("quotes a templated HTML original from its HTML, not from the tag-stripped text part it ships", async () => {
    // A vendor's order mail: layout tables in the HTML, and a text/plain part that is
    // that HTML with the tags deleted, blank lines and entities included.
    const html =
      '<table width="100%"><tbody>\r\n<tr>\r\n<td><table width="600"><tbody>\r\n<tr>\r\n' +
      "<td><strong>Stimate client, Ana-Maria Popescu,</strong> <br /><br /> Va multumim pentru comanda.</td>\r\n</tr>\r\n" +
      "<tr>\r\n<td><p>Comanda va fi livrată în 3 zile.</p></td>\r\n</tr>\r\n" +
      "<tr><td>&copy; 2025 Exemplu Shop.</td></tr>\r\n</tbody></table></td>\r\n</tr>\r\n</tbody></table>";
    const junk = "\r\n".repeat(26) + "Stimate client, Ana-Maria Popescu,  Va multumim pentru comanda.\r\n\r\n\r\n\r\n\r\n" +
      "Comanda va fi livrată în 3 zile.\r\n\r\n\r\n&copy; 2025 Exemplu Shop.\r\n\r\n\r\n";
    const templated: RawMessage = {
      id: "c",
      threadId: "t",
      payload: {
        mimeType: "multipart/mixed",
        headers: [
          { name: "From", value: "office@shop.example" },
          { name: "To", value: "ana.popescu@example.com" },
          { name: "Subject", value: "Exemplu Shop - Confirmare comandă" },
          { name: "Message-ID", value: "<order@shop.example>" },
          { name: "Date", value: "Mon, 07 Sep 2026 10:30:00 +0300 (EEST)" },
        ],
        parts: [
          {
            mimeType: "multipart/alternative",
            parts: [
              { mimeType: "text/plain", body: { data: b64(junk) } },
              { mimeType: "text/html", body: { data: b64(html) } },
            ],
          },
        ],
      },
    };
    const createDraft = vi.fn(async (_raw: string, _threadId?: string) => ({ id: "r-1", message: { id: "d", threadId: "t" } }));
    const deps = personal({ htmlToText, gmail: gmailStub({ getMessage: async () => templated }), write: { ...personal().write, createDraft } });
    await reply(deps, { messageId: "c", replyAll: false, quote: true, send: false, bodyText: "Bună ziua," });
    const raw = createDraft.mock.calls[0]?.[0] as string;

    const text = textOf(raw);
    expect(text).toContain("On Mon, Sep 7, 2026 at 10:30\u202fAM <office@shop.example> wrote:\n\n> Stimate client, Ana-Maria Popescu,\n>\n> Va multumim pentru comanda.");
    expect(text).toContain("> © 2025 Exemplu Shop.");
    expect(text).not.toContain("&copy;");
    expect(text).not.toMatch(/^>\n>$/m);

    const quoted = htmlOf(raw) ?? "";
    expect(quoted).toMatch(/^<div dir="ltr">Bună ziua,<\/div><br><div class="gmail_quote gmail_quote_container">/);
    expect(quoted).toContain('<blockquote class="gmail_quote"');
    expect(quoted).toContain("<strong>Stimate client, Ana-Maria Popescu,</strong>");
  });

  it("sends only when told to, and returns the sent message's link", async () => {
    const createDraft = vi.fn();
    const sendMessage = vi.fn(async (_raw: string, threadId?: string) => ({ id: "1a0000000000000f", threadId: threadId as string, labelIds: ["SENT"] }));
    const out = await reply(personal({ write: { ...personal().write, createDraft, sendMessage } }), {
      messageId: "m",
      replyAll: false,
      quote: false,
      send: true,
      bodyText: "ok",
    });
    expect(createDraft).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls[0]?.[1]).toBe("18c0000000000001");
    expect(out).toMatchObject({ sent: true, messageId: "1a0000000000000f" });
    expect(out.webUrl).toContain("#all/thread-f:1783425452438716417|msg-f:");
  });

  it("goes out from the alias the original reached, with that alias's name", async () => {
    const createDraft = vi.fn(async (_raw: string, _threadId?: string) => ({ id: "r-1", message: { id: "d", threadId: "t" } }));
    const incoming: RawMessage = {
      id: "m",
      threadId: "t",
      payload: {
        headers: [
          { name: "From", value: "Client <c@client.example>" },
          { name: "To", value: "ana@alias.example" },
          { name: "Subject", value: "Quote" },
          { name: "Message-ID", value: "<q@client.example>" },
        ],
      },
    };
    const deps = depsWith({
      address: "ana@work.example",
      gmail: gmailStub({ getMessage: async () => incoming }),
      write: writeStub({
        createDraft,
        sendAs: async () => ({
          sendAs: [
            { sendAsEmail: "ana@work.example", isPrimary: true, isDefault: true, displayName: "" },
            { sendAsEmail: "ana@alias.example", displayName: "Ana Popescu", verificationStatus: "accepted" },
          ],
        }),
      }),
    });
    await reply(deps, { messageId: "m", replyAll: false, quote: false, send: false, bodyText: "x" });
    expect(headersOfRaw(createDraft.mock.calls[0]?.[0] as string)).toContain("From: Ana Popescu <ana@alias.example>");
  });

  it("refuses a From that is not one of the account's send-as addresses", async () => {
    const err = await errorOf(reply(personal(), { messageId: "m", replyAll: false, quote: false, send: false, from: "ceo@elsewhere.example" }));
    expect(err).toMatchObject({ kind: "input" });
    expect(err?.message).toContain("ana.popescu@example.com");
  });
});

/**
 * An Outlook reply with its signature logo by cid: (an "attachment" part, the
 * way Outlook sends it) and a real file. Gmail folds a reply's quote behind
 * "•••" only while the quote repeats this message, images included; a quote
 * that points at images it does not carry loses them on Send and shows the
 * whole thread.
 */
const LOGO = Buffer.from("\x89PNG logo bytes", "latin1");
const outlookOriginal: RawMessage = {
  id: "o1",
  threadId: "18c0000000000001",
  payload: {
    mimeType: "multipart/mixed",
    headers: [
      { name: "From", value: "Maria Ionescu <maria.ionescu@recruiter.example>" },
      { name: "To", value: "Ana Popescu <ana.popescu@example.com>" },
      { name: "Subject", value: "RE: Example project" },
      { name: "Message-ID", value: "<reply@recruiter.example>" },
      { name: "References", value: "<first@recruiter.example> <CAmine@mail.example.com>" },
      { name: "Date", value: "Tue, 15 Jan 2030 19:41:00 +0000" },
    ],
    parts: [
      {
        mimeType: "multipart/related",
        parts: [
          {
            mimeType: "multipart/alternative",
            parts: [
              { mimeType: "text/plain", body: { data: b64("Hello Ana,\r\n\r\nTomorrow at 10 works.\r\n") } },
              {
                mimeType: "text/html",
                body: {
                  data: b64(
                    '<html><head><meta charset="utf-8"></head><body><div dir="ltr">Hello Ana,</div><div dir="ltr">Tomorrow at 10 works.</div>' +
                      '<p><img src="cid:image001.png@00000000.00000001" alt="logo"></p><hr><div id="divRplyFwdMsg"><b>From:</b> Ana Popescu</div><div>Hi Maria</div></body></html>',
                  ),
                },
              },
            ],
          },
          {
            mimeType: "image/png",
            filename: "image001.png",
            headers: [
              { name: "Content-Disposition", value: 'attachment; filename="image001.png"' },
              { name: "Content-ID", value: "<image001.png@00000000.00000001>" },
            ],
            body: { attachmentId: "logo-1", size: LOGO.length },
          },
        ],
      },
      { mimeType: "application/pdf", filename: "JD.pdf", body: { attachmentId: "jd-1", size: 8 } },
    ],
  },
};

/** The MIME tree as content types, children indented. */
const tree = (raw: string, depth = 0): string[] => {
  const type = /^Content-Type: ([^;\r\n]+)/im.exec(raw)?.[1] ?? "?";
  const boundary = /boundary="([^"]+)"/i.exec(raw.slice(0, raw.search(/\r\n\r\n|\r\n--/)))?.[1];
  const line = `${"  ".repeat(depth)}${type}`;
  if (!type.startsWith("multipart/") || !boundary) {
    const cid = /^Content-ID: (.+)$/im.exec(raw)?.[1];
    return [`${line}${cid ? ` ${cid.trim()}` : ""}`];
  }
  return [line, ...raw.split(`--${boundary}`).slice(1, -1).flatMap((p) => tree(p.replace(/^\r\n/, ""), depth + 1))];
};

describe("the images a quote shows", () => {
  const recruiter = (over: Parameters<typeof depsWith>[0] = {}) => {
    const getAttachment = vi.fn(async (_m: string, id: string) => (id === "logo-1" ? LOGO : Buffer.from("%PDF-1.7")));
    return {
      getAttachment,
      deps: personal({ htmlToText, gmail: gmailStub({ getMessage: async () => outlookOriginal, getAttachment }), ...over }),
    };
  };

  it("travel with a quoted reply, beside the HTML in multipart/related; the original's files do not", async () => {
    const createDraft = vi.fn(async (_raw: string, threadId?: string) => ({ id: "r-7", message: { id: "d", threadId: threadId as string } }));
    const { deps, getAttachment } = recruiter({ write: { ...personal().write, createDraft } });
    const out = await reply(deps, { messageId: "o1", replyAll: false, quote: true, send: false, bodyText: "Tomorrow at 10, then." });
    const [raw, threadId] = createDraft.mock.calls[0] as [string, string];

    expect(tree(raw)).toEqual([
      "multipart/related",
      "  multipart/alternative",
      "    text/plain",
      "    text/html",
      "  image/png <image001.png@00000000.00000001>",
    ]);
    expect(raw).toContain('Content-Disposition: inline; filename="image001.png"');
    expect(raw).toContain(LOGO.toString("base64"));
    expect(getAttachment).toHaveBeenCalledTimes(1);
    expect(raw).not.toContain("JD.pdf");
    expect(out).toMatchObject({ inlineImages: 1 });
    expect(out).not.toHaveProperty("attachments");

    // Still a reply that threads, with a sane text part and the HTML twin.
    expect(threadId).toBe("18c0000000000001");
    const h = headersOfRaw(raw);
    expect(h).toContain("Subject: RE: Example project");
    expect(h).toContain("In-Reply-To: <reply@recruiter.example>");
    expect(h).toContain("References: <first@recruiter.example> <CAmine@mail.example.com> <reply@recruiter.example>");
    expect(textOf(raw)).toBe(
      "Tomorrow at 10, then.\n\nOn Tue, Jan 15, 2030 at 9:41\u202fPM Maria Ionescu <maria.ionescu@recruiter.example> wrote:\n\n" +
        "> Hello Ana,\n> Tomorrow at 10 works.\n>\n> ----------------------------------------\n>\n> From: Ana Popescu\n> Hi Maria\n",
    );
    const html = htmlOf(raw) ?? "";
    expect(html).toMatch(/^<div dir="ltr">Tomorrow at 10, then\.<\/div><br><div class="gmail_quote gmail_quote_container">/);
    expect(html).toContain('<img src="cid:image001.png@00000000.00000001" alt="logo">');
  });

  it("stay behind when the reply does not quote", async () => {
    const createDraft = vi.fn(async (_raw: string, threadId?: string) => ({ id: "r-7", message: { id: "d", threadId: threadId as string } }));
    const { deps, getAttachment } = recruiter({ write: { ...personal().write, createDraft } });
    await reply(deps, { messageId: "o1", replyAll: false, quote: false, send: false, bodyText: "ok" });
    expect(tree(createDraft.mock.calls[0]?.[0] as string)).toEqual(["multipart/alternative", "  text/plain", "  text/html"]);
    expect(getAttachment).not.toHaveBeenCalled();
  });

  it("travel with a forward even without its attachments, and once with them", async () => {
    const createDraft = vi.fn(async (_raw: string, threadId?: string) => ({ id: "r-8", message: { id: "d", threadId: threadId as string } }));
    const { deps } = recruiter({ write: { ...personal().write, createDraft } });
    await forward(deps, { messageId: "o1", to: ["partner@example.com"], includeAttachments: false, send: false });
    expect(tree(createDraft.mock.calls[0]?.[0] as string)).toEqual([
      "multipart/related",
      "  multipart/alternative",
      "    text/plain",
      "    text/html",
      "  image/png <image001.png@00000000.00000001>",
    ]);

    const out = await forward(deps, { messageId: "o1", to: ["partner@example.com"], includeAttachments: true, send: false });
    expect(tree(createDraft.mock.calls[1]?.[0] as string)).toEqual([
      "multipart/mixed",
      "  multipart/related",
      "    multipart/alternative",
      "      text/plain",
      "      text/html",
      "    image/png <image001.png@00000000.00000001>",
      "  application/pdf",
    ]);
    expect(out).toMatchObject({ inlineImages: 1, attachments: [{ filename: "JD.pdf" }] });
  });

  it("follow the body when a quoted reply draft is edited: kept with it, gone with a new one", async () => {
    const createDraft = vi.fn(async (_raw: string, threadId?: string) => ({ id: "r-7", message: { id: "d", threadId: threadId as string } }));
    const { deps } = recruiter({ write: { ...personal().write, createDraft } });
    await reply(deps, { messageId: "o1", replyAll: false, quote: true, send: false, bodyText: "Tomorrow at 10, then." });

    // The draft as Gmail hands it back: the raw MIME re-read as parts.
    const raw = createDraft.mock.calls[0]?.[0] as string;
    const html = htmlOf(raw) ?? "";
    const draft = {
      id: "r-7",
      message: {
        id: "d7",
        threadId: "18c0000000000001",
        payload: {
          mimeType: "multipart/mixed",
          headers: [
            { name: "To", value: "maria.ionescu@recruiter.example" },
            { name: "Subject", value: "RE: Example project" },
            { name: "In-Reply-To", value: "<reply@recruiter.example>" },
            { name: "References", value: "<first@recruiter.example> <reply@recruiter.example>" },
          ],
          parts: [
            {
              mimeType: "multipart/related",
              parts: [
                {
                  mimeType: "multipart/alternative",
                  parts: [
                    { mimeType: "text/plain", body: { data: b64(textOf(raw)) } },
                    { mimeType: "text/html", body: { data: b64(html) } },
                  ],
                },
                {
                  mimeType: "image/png",
                  filename: "image001.png",
                  headers: [{ name: "Content-ID", value: "<image001.png@00000000.00000001>" }],
                  body: { attachmentId: "logo-1" },
                },
              ],
            },
            { mimeType: "application/pdf", filename: "cv.pdf", body: { attachmentId: "cv-1" } },
          ],
        },
      },
    };
    const updateDraftCall = vi.fn(async (id: string, _raw: string, threadId?: string) => ({ id, message: { id: "d8", threadId: threadId as string } }));
    const edit = recruiter({ write: { ...personal().write, getDraft: async () => draft, updateDraft: updateDraftCall } });

    await updateDraft(edit.deps, "r-7", { subject: "RE: Example project, tomorrow at 10" });
    expect(tree(updateDraftCall.mock.calls[0]?.[1] as string)).toEqual([
      "multipart/mixed",
      "  multipart/related",
      "    multipart/alternative",
      "      text/plain",
      "      text/html",
      "    image/png <image001.png@00000000.00000001>",
      "  application/pdf",
    ]);

    const out = await updateDraft(edit.deps, "r-7", { bodyText: "Actually, 11 suits me better." });
    expect(tree(updateDraftCall.mock.calls[1]?.[1] as string)).toEqual([
      "multipart/mixed",
      "  multipart/alternative",
      "    text/plain",
      "    text/html",
      "  application/pdf",
    ]);
    expect(out).toMatchObject({ attachments: [{ filename: "cv.pdf" }] });
    expect(out).not.toHaveProperty("inlineImages");
  });
});

describe("forward", () => {
  it("carries every attachment, the inline-data ones included, under a Fwd: subject in the same thread", async () => {
    const createDraft = vi.fn(async (_raw: string, threadId?: string) => ({ id: "r-9", message: { id: "d", threadId: threadId as string } }));
    await forward(personal({ write: { ...personal().write, createDraft } }), {
      messageId: "m",
      to: ["accountant@example.com"],
      includeAttachments: true,
      send: false,
      bodyText: "FYI",
    });
    const [raw, threadId] = createDraft.mock.calls[0] as [string, string];
    expect(threadId).toBe("18c0000000000001");
    expect(headersOfRaw(raw)).toContain("Subject: Fwd: Re: Example project");
    expect(raw).toContain('filename="Ana_Popescu_resume.pdf"');
    expect(raw).toContain(Buffer.from("%PDF-1.7").toString("base64"));
    expect(raw).toContain('filename="note.txt"');
    expect(raw).toContain(Buffer.from("inline small file").toString("base64"));
    expect(textOf(raw)).toContain("FYI\n\n---------- Forwarded message ---------\nFrom: Ana Popescu <ana.popescu@example.com>");
  });

  it("needs somebody to forward to", async () => {
    const err = await errorOf(forward(personal(), { messageId: "m", includeAttachments: true, send: false }));
    expect(err).toMatchObject({ kind: "input" });
  });
});

describe("updateDraft", () => {
  it("changes only what it is given and keeps a reply draft threaded, attachments included", async () => {
    const existing = {
      id: "r-5",
      message: {
        id: "d5",
        threadId: "18c0000000000001",
        payload: {
          headers: [
            { name: "To", value: "maria.ionescu@recruiter.example" },
            { name: "Bcc", value: "me@example.com" },
            { name: "Subject", value: "Re: Example project" },
            { name: "In-Reply-To", value: "<CAmine@mail.example.com>" },
            { name: "References", value: "<first@x> <CAmine@mail.example.com>" },
          ],
          parts: [
            { mimeType: "text/plain", body: { data: b64("old body") } },
            { mimeType: "application/pdf", filename: "cv.pdf", body: { attachmentId: "a1" } },
          ],
        },
      },
    };
    const updateDraftCall = vi.fn(async (id: string, _raw: string, threadId?: string) => ({ id, message: { id: "d6", threadId: threadId as string } }));
    const getAttachment = vi.fn(async () => Buffer.from("CVBYTES"));
    const deps = personal({
      gmail: gmailStub({ getAttachment }),
      write: { ...personal().write, getDraft: async () => existing, updateDraft: updateDraftCall },
    });
    await updateDraft(deps, "r-5", { subject: "Re: Example project - follow-up" });

    const [id, raw, threadId] = updateDraftCall.mock.calls[0] as [string, string, string];
    expect(id).toBe("r-5");
    expect(threadId).toBe("18c0000000000001");
    const h = headersOfRaw(raw);
    expect(h).toContain("Subject: Re: Example project - follow-up");
    expect(h).toContain("To: maria.ionescu@recruiter.example");
    expect(h).toContain("Bcc: me@example.com");
    expect(h).toContain("In-Reply-To: <CAmine@mail.example.com>");
    expect(h).toContain("References: <first@x> <CAmine@mail.example.com>");
    expect(textOf(raw)).toBe("old body");
    expect(getAttachment).toHaveBeenCalledWith("d5", "a1");
    expect(raw).toContain(Buffer.from("CVBYTES").toString("base64"));
  });
});

describe("sendDraft", () => {
  /** A lookup failing BESIDE a successful send would report an error for mail already gone. */
  it("reads everything it needs before sending, never alongside", async () => {
    const sendDraftCall = vi.fn();
    const deps = depsWith({
      write: writeStub({
        sendAs: async () => {
          throw new Error("sendAs down");
        },
        sendDraft: sendDraftCall,
      }),
    });
    await expect(sendDraft(deps, "r-1")).rejects.toThrow("sendAs down");
    expect(sendDraftCall).not.toHaveBeenCalled();
  });
});

describe("modifyLabels", () => {
  const labels = async () => ({
    labels: [
      { id: "INBOX", name: "INBOX", type: "system" },
      { id: "STARRED", name: "STARRED", type: "system" },
      { id: "Label_7", name: "Clients/Acme", type: "user" },
    ],
  });

  it("resolves names case-insensitively and acts per thread", async () => {
    const modifyThread = vi.fn(async () => ({}));
    const deps = depsWith({ gmail: gmailStub({ labels }), write: writeStub({ modifyThread }) });
    const out = await modifyLabels(deps, { target: "thread", ids: ["t1", "t2"], add: ["clients/acme", "starred"], remove: ["inbox"] });
    expect(modifyThread).toHaveBeenCalledTimes(2);
    expect(modifyThread).toHaveBeenCalledWith("t1", { add: ["Label_7", "STARRED"], remove: ["INBOX"] });
    expect(out).toMatchObject({ added: ["Label_7", "STARRED"], removed: ["INBOX"] });
  });

  it("refuses an unknown label instead of silently dropping it", async () => {
    const deps = depsWith({ gmail: gmailStub({ labels }) });
    const err = await errorOf(modifyLabels(deps, { target: "message", ids: ["m"], add: ["Nope"], remove: [] }));
    expect(err).toMatchObject({ kind: "input" });
  });
});

describe("createDraft", () => {
  it("rejects a recipient that is not an address", async () => {
    const err = await errorOf(createDraft(depsWith(), { to: ["not an address"] }));
    expect(err).toMatchObject({ kind: "input" });
  });

  it("adds a plain-text alternative to an HTML-only body", async () => {
    const createDraftCall = vi.fn(async (_raw: string, _threadId?: string) => ({ id: "r-1", message: { id: "d", threadId: "d" } }));
    await createDraft(depsWith({ write: writeStub({ createDraft: createDraftCall }) }), { to: ["a@example.com"], bodyHtml: "<p>Hello <b>there</b></p>" });
    const raw = createDraftCall.mock.calls[0]?.[0] as string;
    expect(raw).toContain("multipart/alternative");
    expect(textOf(raw)).toBe("Hello there");
  });

  it("works with the grant this test's fakes default to", async () => {
    expect((await depsWith().grant.scopes())).toContain(MODIFY);
  });
});

describe("attachments in", () => {
  const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
  const pdf = Buffer.from("%PDF-1.7\n\u00e2\u00e3 binary \u0000\u00ff\n%%EOF\n", "latin1");

  /** Deps whose file reader takes paths from `inbox` only, as a deployed server reads attachments from its inbox directory. */
  const withInbox = (inbox: string, createDraftCall = vi.fn(async (_raw: string, _t?: string) => ({ id: "r-1", message: { id: "d", threadId: "d" } }))) => ({
    createDraftCall,
    deps: depsWith({
      write: writeStub({ createDraft: createDraftCall }),
      files: { writeFile: async () => "/tmp/x", readInput: inputFilesWith([inbox]) },
    }),
  });

  const failureOf = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (thrown) {
      return asInputFileError(thrown);
    }
    throw new Error("expected a failure");
  };

  it("attaches a file from the inbox by its path, byte for byte, and says what it attached", async () => {
    const inbox = await mkdtemp(join(tmpdir(), "gmail-inbox-"));
    await writeFile(join(inbox, "Factura 12.pdf"), pdf);
    const { deps, createDraftCall } = withInbox(inbox);
    const out = await createDraft(deps, { to: ["a@example.com"], attachments: [{ path: "Factura 12.pdf" }] });
    const raw = createDraftCall.mock.calls[0]?.[0] as string;
    expect(raw).toContain('filename="Factura 12.pdf"');
    expect(raw.replace(/\r\n/g, "")).toContain(pdf.toString("base64"));
    expect(out).toMatchObject({ attachments: [{ filename: "Factura 12.pdf", size: pdf.length, sha256: sha(pdf) }] });
    await rm(inbox, { recursive: true, force: true });
  });

  it("refuses base64 whose bytes are not the source's, and sends nothing", async () => {
    const inbox = await mkdtemp(join(tmpdir(), "gmail-inbox-"));
    const { deps, createDraftCall } = withInbox(inbox);
    const b64 = pdf.toString("base64");
    const typo = `${b64.slice(0, 8)}${b64[8] === "2" ? "6" : "2"}${b64.slice(9)}`;
    const failure = await failureOf(createDraft(deps, { to: ["a@example.com"], attachments: [{ contentBase64: typo, sha256: sha(pdf), filename: "a.pdf" }] }));
    expect(failure).toMatchObject({ kind: "checksum_mismatch", expected_sha256: sha(pdf), size: pdf.length });
    expect(await failureOf(createDraft(deps, { to: ["a@example.com"], attachments: [{ contentBase64: b64, filename: "a.pdf" }] }))).toMatchObject({
      code: "sha256_required",
    });
    expect(createDraftCall).not.toHaveBeenCalled();
    const ok = await createDraft(deps, { to: ["a@example.com"], attachments: [{ contentBase64: b64, sha256: sha(pdf), filename: "a.pdf" }] });
    expect(ok).toMatchObject({ attachments: [{ filename: "a.pdf", sha256: sha(pdf) }] });
    await rm(inbox, { recursive: true, force: true });
  });

  it("refuses a link in the inbox to the service's own grants", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gmail-inbox-"));
    const inbox = join(dir, "inbox");
    await mkdir(inbox);
    await writeFile(join(dir, "credentials.json"), '{"refresh_token":"x"}');
    await symlink(join(dir, "credentials.json"), join(inbox, "invoice.pdf"));
    const { deps, createDraftCall } = withInbox(inbox);
    expect(await failureOf(createDraft(deps, { to: ["a@example.com"], attachments: [{ path: "invoice.pdf" }] }))).toMatchObject({ code: "symlink" });
    expect(createDraftCall).not.toHaveBeenCalled();
    await rm(dir, { recursive: true, force: true });
  });

  it("lists a forward's carried attachments with the new ones", async () => {
    const createDraft = vi.fn(async (_raw: string, threadId?: string) => ({ id: "r-9", message: { id: "d", threadId: threadId as string } }));
    const out = await forward(personal({ write: { ...personal().write, createDraft } }), {
      messageId: "m",
      to: ["accountant@example.com"],
      includeAttachments: true,
      send: false,
      attachments: [{ contentBase64: Buffer.from("x").toString("base64"), sha256: sha("x"), filename: "x.txt" }],
    });
    expect((out as { attachments: { filename: string }[] }).attachments.map((a) => a.filename)).toEqual([
      "Ana_Popescu_resume.pdf",
      "note.txt",
      "x.txt",
    ]);
  });

  it("refuses attachments over the 30 MiB guard together, before anything reaches Gmail", async () => {
    const createDraftCall = vi.fn(async (_raw: string, _t?: string) => ({ id: "r-1", message: { id: "d", threadId: "d" } }));
    const sixteen = Buffer.alloc(16 * 1024 * 1024);
    const readInput = vi.fn(async () => ({ bytes: sixteen, sha256: sha(sixteen), size: sixteen.length, name: "part.bin" }));
    const deps = depsWith({ write: writeStub({ createDraft: createDraftCall }), files: { writeFile: async () => "/tmp/x", readInput } });
    const err = await errorOf(createDraft(deps, { to: ["a@example.com"], attachments: [{ path: "a.bin" }, { path: "b.bin" }] }));
    expect(err).toMatchObject({ kind: "input", message: expect.stringMatching(/32\.0 MiB together, over this server's 30\.0 MiB guard/) });
    expect(createDraftCall).not.toHaveBeenCalled();
    expect(await createDraft(deps, { to: ["a@example.com"], attachments: [{ path: "a.bin" }] })).toMatchObject({ attachments: [{ size: sixteen.length }] });
  });
});
