import { describe, expect, it } from "vitest";

import { bodyOf, MAX_BODY_CHARS } from "../../src/gmail/domain/body.js";
import type { MimePart } from "../../src/gmail/domain/mime.js";

const part = (mimeType: string, text: string): MimePart => ({
  mimeType,
  body: { data: Buffer.from(text, "utf8").toString("base64url") },
});

const shout = (html: string) => `CONVERTED:${html.replace(/<[^>]+>/g, "")}`;

describe("bodyOf", () => {
  it("prefers a real text/plain part over html", () => {
    const payload = { parts: [part("text/html", "<b>html</b>"), part("text/plain", "plain wins")] };
    expect(bodyOf(payload, "text", shout)).toEqual({ body: "plain wins", bodySource: "plain" });
  });

  it("converts html-only mail instead of returning markup", () => {
    const payload = { parts: [part("text/html", "<p>Salut lume</p>")] };
    expect(bodyOf(payload, "text", shout)).toEqual({
      body: "CONVERTED:Salut lume",
      bodySource: "html-converted",
    });
  });

  it("returns markup untouched at raw_html, without calling the converter", () => {
    const boom = () => {
      throw new Error("converter must not run for raw_html");
    };
    const payload = { parts: [part("text/html", "<p>keep me</p>")] };
    expect(bodyOf(payload, "raw_html", boom)).toEqual({ body: "<p>keep me</p>", bodySource: "html" });
  });

  it("falls back to plain at raw_html when there is no html part", () => {
    const payload = { parts: [part("text/plain", "only plain")] };
    expect(bodyOf(payload, "raw_html", shout)).toEqual({ body: "only plain", bodySource: "plain" });
  });

  it("truncates a runaway body and says so", () => {
    const payload = part("text/plain", "x".repeat(MAX_BODY_CHARS + 500));
    const out = bodyOf(payload, "text", shout);
    expect(out.body?.endsWith("chars]")).toBe(true);
    expect(out.body?.length).toBeLessThan(MAX_BODY_CHARS + 100);
  });

  it("reports none rather than guessing when nothing is decodable", () => {
    expect(bodyOf({ mimeType: "multipart/mixed", parts: [] }, "text", shout)).toEqual({
      body: undefined,
      bodySource: "none",
    });
  });

  it("finds a body nested several levels down", () => {
    const payload = { parts: [{ parts: [{ parts: [part("text/plain", "deep")] }] }] };
    expect(bodyOf(payload, "text", shout).body).toBe("deep");
  });
});
