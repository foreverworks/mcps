/**
 * The quote under a reply and the block under a forward, against the shapes
 * Gmail's own Reply and Forward write for such originals. Gmail folds a quote behind "•••" when its HTML
 * repeats the earlier message, images included, so the shapes here, and the
 * images carried with them, are what keeps an MCP reply looking like one
 * written in Gmail.
 */
import { describe, expect, it } from "vitest";

import { bareCid, buildMime, cidsIn } from "../../src/gmail/domain/compose.js";
import { gmailDate, plainTextAsHtml, withForwarded, withQuote } from "../../src/gmail/domain/quote.js";
import type { Original } from "../../src/gmail/domain/threading.js";
import { htmlToText } from "../../src/gmail/infra/htmlText.js";

const ctx = { htmlToText, timeZone: "Europe/Bucharest" };
const lf = (s: string) => s.replace(/\r\n/g, "\n");

/** A message written in Gmail, as the API returns its HTML part. */
const fromGmail: Original = {
  from: "Ana Popescu <ana.popescu@example.com>",
  to: "maria.ionescu@example.org",
  subject: "Slides for Thursday",
  date: "Wed, 14 Oct 2026 09:15:00 -0500",
};
const gmailHtml =
  '<div dir="ltr">Hi,<br>\r\n<br>\r\nThe slides for Thursday are attached. Tell me if anything&#39;s missing.<br>\r\n<br>\r\nAna</div>\r\n';

/**
 * An Outlook reply, reduced: a whole HTML document, quoted font names, the
 * signature's logo by cid:, and the earlier thread under Outlook's separator.
 */
const fromOutlook: Original = {
  from: "Iulia Ionescu <iulia.ionescu@recruiter.example>",
  to: "Ana Popescu <ana.popescu@example.com>",
  cc: "talent@recruiter.example",
  subject: "Re: Quarterly report",
  date: "Tue, 15 Jan 2030 19:41:00 +0000",
};
const outlookHtml = [
  "<html>",
  "<head>",
  '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">',
  "</head>",
  "<body>",
  '<div dir="ltr" style="font-family: &quot;Segoe UI&quot;, Arial, Helvetica, sans-serif; font-size: 12pt;">',
  "Hello Ana,</div>",
  '<div dir="ltr" style="font-family: &quot;Segoe UI&quot;, Arial, Helvetica, sans-serif; font-size: 12pt;">',
  "Glad we set up tomorrow&#39;s call.&nbsp;</div>",
  '<p><span><img src="cid:image001.png@00000000.00000001" alt="signature" width="193" height="54"></span></p>',
  '<hr style="display: inline-block; width: 98%;">',
  '<div id="divRplyFwdMsg" dir="ltr"><b>From:</b> Ana Popescu &lt;ana.popescu@example.com&gt;<br><b>Sent:</b> Monday, 14 January 2030 09:00:00</div>',
  '<div dir="auto">Thanks for the update.</div>',
  "</body>",
  "</html>",
].join("\r\n");

const QUOTE = '<blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">';

describe("gmailDate", () => {
  it("writes a Date header the way Gmail does, in the readers' zone", () => {
    expect(gmailDate("Wed, 14 Oct 2026 09:15:00 -0500", "Europe/Bucharest")).toBe("Wed, Oct 14, 2026 at 5:15 PM");
    expect(gmailDate("Tue, 15 Jan 2030 19:41:00 +0000", "Europe/Bucharest")).toBe("Tue, Jan 15, 2030 at 9:41 PM");
    expect(gmailDate("Mon, 07 Sep 2026 10:30:00 +0300 (EEST)", "Europe/Bucharest")).toBe("Mon, Sep 7, 2026 at 10:30 AM");
    expect(gmailDate("Sun, 25 Oct 2026 22:05:00 +0000", "Europe/Bucharest")).toBe("Mon, Oct 26, 2026 at 12:05 AM");
  });

  it("keeps a header it cannot read, and has nothing to say about none", () => {
    expect(gmailDate("sometime last week", "Europe/Bucharest")).toBe("sometime last week");
    expect(gmailDate(undefined, "Europe/Bucharest")).toBeUndefined();
  });
});

describe("withQuote", () => {
  it("quotes a Gmail original byte for byte as Gmail's own Reply does", () => {
    const out = withQuote({ text: "Thanks, all there.", html: plainTextAsHtml("Thanks, all there.") }, fromGmail, { html: gmailHtml }, ctx);
    expect(lf(out.html ?? "")).toBe(
      '<div dir="ltr">Thanks, all there.</div>' +
        '<br><div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">On Wed, Oct 14, 2026 at 5:15 PM Ana Popescu ' +
        '&lt;<a href="mailto:ana.popescu@example.com">ana.popescu@example.com</a>&gt; wrote:<br></div>' +
        `${QUOTE}<div dir="ltr">Hi,<br>\n<br>\nThe slides for Thursday are attached. Tell me if anything&#39;s missing.<br>\n<br>\nAna</div>\n</blockquote></div>`,
    );
    expect(out.text).toBe(
      "Thanks, all there.\n\nOn Wed, Oct 14, 2026 at 5:15 PM Ana Popescu <ana.popescu@example.com> wrote:\n\n" +
        "> Hi,\n>\n> The slides for Thursday are attached. Tell me if anything's missing.\n>\n> Ana\n",
    );
  });

  it("quotes an Outlook original whole: its document, its images by cid:, the thread under it", () => {
    const out = withQuote({ text: "See you then.", html: plainTextAsHtml("See you then.") }, fromOutlook, { html: outlookHtml }, ctx);
    const html = out.html ?? "";
    expect(html).toContain(
      '<div dir="ltr" class="gmail_attr">On Tue, Jan 15, 2030 at 9:41 PM Iulia Ionescu &lt;<a href="mailto:iulia.ionescu@recruiter.example">iulia.ionescu@recruiter.example</a>&gt; wrote:<br></div>',
    );
    expect(html).toContain(`${QUOTE}${outlookHtml}</blockquote></div>`);
    expect([...cidsIn(html)]).toEqual(["image001.png@00000000.00000001"]);
    // The text alternative reads the HTML, one paragraph per line, never hard-wrapped.
    expect(out.text).toContain("On Tue, Jan 15, 2030 at 9:41 PM Iulia Ionescu <iulia.ionescu@recruiter.example> wrote:\n\n> Hello Ana,");
    expect(out.text).toContain("> Glad we set up tomorrow's call.");
    expect(out.text).not.toMatch(/&quot;|&nbsp;|<html>/);
  });

  it("quotes a plain-text original as text, in HTML that keeps its lines", () => {
    const out = withQuote({ text: "Done.", html: plainTextAsHtml("Done.") }, { from: "noreply@builds.example", date: "Wed, 14 Oct 2026 09:15:00 -0500" }, { text: "Build 412 passed.\nArtifacts: 3" }, ctx);
    expect(out.html).toContain(`<div dir="ltr" class="gmail_attr">On Wed, Oct 14, 2026 at 5:15 PM &lt;<a href="mailto:noreply@builds.example">noreply@builds.example</a>&gt; wrote:<br></div>${QUOTE}Build 412 passed.<br>\nArtifacts: 3</blockquote>`);
    expect(out.text).toBe("Done.\n\nOn Wed, Oct 14, 2026 at 5:15 PM <noreply@builds.example> wrote:\n\n> Build 412 passed.\n> Artifacts: 3\n");
  });

  it("leaves a body type the reply does not have alone", () => {
    expect(withQuote({ text: "ok" }, fromGmail, { html: gmailHtml }, ctx)).not.toHaveProperty("html");
  });
});

describe("withForwarded", () => {
  it("writes Gmail's Forwarded message block over a Gmail original", () => {
    const out = withForwarded({ text: "FYI" }, fromGmail, { html: gmailHtml }, ctx);
    expect(lf(out.html ?? "")).toBe(
      '<div dir="ltr">FYI</div><br><br>' +
        '<div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">---------- Forwarded message ---------<br>' +
        'From: <strong class="gmail_sendername" dir="auto">Ana Popescu</strong> <span dir="auto">&lt;<a href="mailto:ana.popescu@example.com">ana.popescu@example.com</a>&gt;</span><br>' +
        "Date: Wed, Oct 14, 2026 at 5:15 PM<br>" +
        "Subject: Slides for Thursday<br>" +
        'To: &lt;<a href="mailto:maria.ionescu@example.org">maria.ionescu@example.org</a>&gt;<br>' +
        `</div><br><br>${lf(gmailHtml)}</div>`,
    );
    expect(out.text).toBe(
      "FYI\n\n---------- Forwarded message ---------\nFrom: Ana Popescu <ana.popescu@example.com>\nDate: Wed, Oct 14, 2026 at 5:15 PM\n" +
        "Subject: Slides for Thursday\nTo: <maria.ionescu@example.org>\n\n\nHi,\n\nThe slides for Thursday are attached. Tell me if anything's missing.\n\nAna",
    );
  });

  it("forwards an Outlook original whole, every addressee linked", () => {
    const out = withForwarded({}, fromOutlook, { html: outlookHtml }, ctx);
    expect(out.html).toContain(
      'To: Ana Popescu &lt;<a href="mailto:ana.popescu@example.com">ana.popescu@example.com</a>&gt;<br>Cc: &lt;<a href="mailto:talent@recruiter.example">talent@recruiter.example</a>&gt;<br></div><br><br><html>',
    );
    expect(out.html?.startsWith('<div class="gmail_quote gmail_quote_container">')).toBe(true);
    expect(cidsIn(out.html).has("image001.png@00000000.00000001")).toBe(true);
  });
});

describe("cidsIn", () => {
  it("finds every image an HTML body shows by Content-ID, however it is written", () => {
    const html = '<img src="cid:image001.png@00000000.00000001"><td style="background:url(cid:bg%40mail.example)"><IMG SRC="CID:ii_0f3c9a1b2d4e5f6071">';
    expect([...cidsIn(html)].sort()).toEqual(["bg@mail.example", "ii_0f3c9a1b2d4e5f6071", "image001.png@00000000.00000001"]);
    expect(cidsIn(undefined).size).toBe(0);
    expect(bareCid("<image001.png@00000000.00000001>")).toBe("image001.png@00000000.00000001");
  });
});

describe("buildMime with a quote's images", () => {
  /** The MIME tree as content types, children indented: enough to see where every part went. */
  const tree = (raw: string, depth = 0): string[] => {
    const type = /^Content-Type: ([^;\r\n]+)/im.exec(raw)?.[1] ?? "?";
    const boundary = /boundary="([^"]+)"/i.exec(raw.slice(0, raw.indexOf("\r\n\r\n")))?.[1];
    const line = `${"  ".repeat(depth)}${type}`;
    if (!type.startsWith("multipart/") || !boundary) {
      const disposition = /^Content-Disposition: (\w+)/im.exec(raw)?.[1];
      const cid = /^Content-ID: (.+)$/im.exec(raw)?.[1];
      return [`${line}${disposition ? ` ${disposition}` : ""}${cid ? ` ${cid.trim()}` : ""}`];
    }
    const parts = raw.split(`--${boundary}`).slice(1, -1).map((p) => p.replace(/^\r\n/, ""));
    return [line, ...parts.flatMap((p) => tree(p, depth + 1))];
  };
  let n = 0;
  const boundary = () => `b${(n += 1)}`;
  const logo = { filename: "image001.png", mimeType: "image/png", data: Buffer.from("PNG"), contentId: "<image001.png@00000000.00000001>" };
  const cv = { filename: "cv.pdf", mimeType: "application/pdf", data: Buffer.from("%PDF") };
  const html = withQuote({ text: "x", html: plainTextAsHtml("x") }, fromOutlook, { html: outlookHtml }, ctx).html ?? "";

  it("puts the images the HTML shows beside it in multipart/related, as Gmail does", () => {
    const raw = buildMime({ to: [{ email: "a@example.com" }], cc: [], bcc: [], subject: "Re: x", text: "x", html, attachments: [logo], references: [] }, boundary);
    expect(tree(raw)).toEqual(["multipart/related", "  multipart/alternative", "    text/plain", "    text/html", "  image/png inline <image001.png@00000000.00000001>"]);
  });

  it("keeps a real attachment outside, in multipart/mixed, and an image nothing shows stays an attachment", () => {
    const stray = { ...logo, contentId: "<unused@example>" };
    const raw = buildMime({ to: [{ email: "a@example.com" }], cc: [], bcc: [], subject: "Re: x", text: "x", html, attachments: [logo, cv, stray], references: [] }, boundary);
    expect(tree(raw)).toEqual([
      "multipart/mixed",
      "  multipart/related",
      "    multipart/alternative",
      "      text/plain",
      "      text/html",
      "    image/png inline <image001.png@00000000.00000001>",
      "  application/pdf attachment",
      "  image/png attachment <unused@example>",
    ]);
  });

  it("writes an image without a file name without empty name parameters", () => {
    const raw = buildMime({ to: [{ email: "a@example.com" }], cc: [], bcc: [], subject: "x", html, attachments: [{ ...logo, filename: "" }], references: [] }, boundary);
    expect(raw).toContain("Content-Type: image/png\r\nContent-Disposition: inline\r\nContent-ID: <image001.png@00000000.00000001>");
  });
});
