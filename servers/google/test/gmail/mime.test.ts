/**
 * The MIME builder. Everything here is what a recipient's client parses, so
 * the assertions are on the bytes: line ends, encodings, boundaries, folding.
 */
import { describe, expect, it } from "vitest";

import { buildMime, mimeTypeFor, type Outgoing } from "../../src/gmail/domain/compose.js";
import { encodeText, encodeWords, header } from "../../src/gmail/domain/headerText.js";

const boundaries = () => {
  let n = 0;
  return () => `B${(n += 1)}`;
};

const base: Outgoing = {
  to: [{ name: "Maria Ionescu", email: "maria@example.com" }],
  cc: [],
  bcc: [],
  subject: "Hello",
  text: "Hi Maria,\nline two",
  attachments: [],
  references: [],
};

/** Decode RFC 2047 B-words the way a client does: adjacent words join with no space. */
const decodeWords = (value: string): string =>
  value
    .replace(/\r\n /g, " ")
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?UTF-8\?B\?([^?]*)\?=/g, (_m, b64: string) => Buffer.from(b64, "base64").toString("utf8"));

const headerBlock = (raw: string) => raw.slice(0, raw.indexOf("\r\n\r\n"));
const bodyAfterHeaders = (part: string) => part.slice(part.indexOf("\r\n\r\n") + 4);

describe("buildMime", () => {
  it("writes a single text part with CRLF line ends and base64 content", () => {
    const raw = buildMime(base, boundaries());
    expect(raw).not.toMatch(/[^\r]\n/);
    expect(raw).toContain("To: Maria Ionescu <maria@example.com>\r\n");
    expect(raw).toContain("Subject: Hello\r\n");
    expect(raw).toContain("MIME-Version: 1.0\r\n");
    expect(raw).toContain('Content-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n');
    expect(Buffer.from(bodyAfterHeaders(raw), "base64").toString("utf8")).toBe("Hi Maria,\r\nline two");
    expect(raw).not.toContain("multipart");
  });

  it("omits From entirely when none is given, so Gmail writes the account's own name", () => {
    expect(buildMime(base, boundaries())).not.toMatch(/^From:/m);
  });

  it("puts text and HTML in multipart/alternative, text first", () => {
    const raw = buildMime({ ...base, html: "<p>Hi</p>" }, boundaries());
    expect(raw).toContain('Content-Type: multipart/alternative; boundary="B1"');
    expect(raw.indexOf("text/plain")).toBeLessThan(raw.indexOf("text/html"));
    expect(raw).toContain("--B1--");
  });

  it("wraps bodies and attachments in multipart/mixed with distinct boundaries", () => {
    const raw = buildMime(
      { ...base, html: "<p>Hi</p>", attachments: [{ filename: "cv.pdf", mimeType: "application/pdf", data: Buffer.from("%PDF-1.7") }] },
      boundaries(),
    );
    expect(raw).toContain('Content-Type: multipart/mixed; boundary="B2"');
    expect(raw).toContain('Content-Type: multipart/alternative; boundary="B1"');
    expect(raw).toContain('Content-Type: application/pdf; name="cv.pdf"\r\nContent-Disposition: attachment; filename="cv.pdf"');
    expect(raw).toContain(Buffer.from("%PDF-1.7").toString("base64"));
    // Every opened boundary is closed, inner before outer.
    expect(raw.indexOf("--B1--")).toBeLessThan(raw.indexOf("--B2--"));
  });

  it("wraps base64 at 76 characters", () => {
    const raw = buildMime({ ...base, attachments: [{ filename: "x.bin", mimeType: "application/octet-stream", data: Buffer.alloc(300, 7) }] }, boundaries());
    const lines = raw.split("\r\n");
    expect(Math.max(...lines.filter((l) => /^[A-Za-z0-9+/=]+$/.test(l)).map((l) => l.length))).toBe(76);
  });

  it("encodes a non-ASCII attachment name both ways, RFC 2231 for clients that read it", () => {
    const raw = buildMime({ ...base, attachments: [{ filename: "Factură Mai.pdf", mimeType: "application/pdf", data: Buffer.from("x") }] }, boundaries());
    expect(raw).toContain("filename*=UTF-8''Factur%C4%83%20Mai.pdf");
    expect(raw).toContain('filename="Factur_ Mai.pdf"');
  });

  it("encodes a non-ASCII subject as UTF-8 words that decode back exactly", () => {
    const subject = "Re: Ofertă pentru proiectul Ștefan cel Mare — 25% reducere până vineri, confirmați vă rog";
    const raw = buildMime({ ...base, subject }, boundaries());
    const line = headerBlock(raw).split("\r\n").findIndex((l) => l.startsWith("Subject:"));
    const lines = headerBlock(raw).split("\r\n");
    let value = (lines[line] as string).slice("Subject: ".length);
    for (let i = line + 1; lines[i]?.startsWith(" "); i += 1) value += `\r\n${lines[i]}`;
    expect(decodeWords(value)).toBe(subject);
    for (const w of value.match(/=\?[^?]+\?B\?[^?]*\?=/g) ?? []) expect(w.length).toBeLessThanOrEqual(75);
  });

  it("never splits a multi-byte character across two encoded words", () => {
    const words = encodeWords("ă".repeat(40));
    for (const w of words) {
      const bytes = Buffer.from(w.slice("=?UTF-8?B?".length, -2), "base64");
      expect(bytes.toString("utf8")).not.toContain("�");
    }
  });

  /** Header injection: a subject carrying CRLF must not be able to add a recipient. */
  it("strips CR and LF out of every header value", () => {
    const raw = buildMime({ ...base, subject: "Hi\r\nBcc: attacker@example.com" }, boundaries());
    expect(headerBlock(raw)).not.toMatch(/^Bcc:/m);
    expect(raw).toContain("Subject: Hi Bcc: attacker@example.com");
  });

  it("carries In-Reply-To and References, folded when the chain is long", () => {
    const refs = Array.from({ length: 12 }, (_, i) => `<message-${i}-with-a-long-id@mail.example.com>`);
    const raw = buildMime({ ...base, inReplyTo: refs.at(-1) as string, references: refs }, boundaries());
    expect(raw).toContain(`In-Reply-To: ${refs.at(-1)}\r\n`);
    const block = headerBlock(raw);
    for (const line of block.split("\r\n")) expect(line.length).toBeLessThanOrEqual(78);
    expect(block.replace(/\r\n /g, " ")).toContain(`References: ${refs.join(" ")}`);
  });

  it("keeps a Bcc header, which Gmail keeps on a draft and strips on delivery", () => {
    const raw = buildMime({ ...base, bcc: [{ email: "hidden@example.com" }] }, boundaries());
    expect(raw).toContain("Bcc: hidden@example.com\r\n");
  });

  it("writes an encoded display name for a non-ASCII sender", () => {
    const raw = buildMime({ ...base, from: { name: "Ștefan Popescu", email: "me@example.com" } }, boundaries());
    const from = headerBlock(raw).split("\r\n").find((l) => l.startsWith("From:")) as string;
    expect(from).toMatch(/^From: =\?UTF-8\?B\?[^?]+\?= <me@example.com>$/);
    expect(decodeWords(from.slice(6))).toBe("Ștefan Popescu <me@example.com>");
  });
});

describe("header", () => {
  it("leaves a short ASCII value on one line", () => {
    expect(header("Subject", "Hello there")).toBe("Subject: Hello there");
  });

  it("passes ASCII subjects through unencoded", () => {
    expect(encodeText("Re: Example project (draft, v2)")).toBe("Re: Example project (draft, v2)");
  });
});

describe("mimeTypeFor", () => {
  it("guesses common types and falls back to octet-stream", () => {
    expect(mimeTypeFor("Ana_Popescu_resume.pdf")).toBe("application/pdf");
    expect(mimeTypeFor("photo.JPG")).toBe("image/jpeg");
    expect(mimeTypeFor("blob")).toBe("application/octet-stream");
  });
});
