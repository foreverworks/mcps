/**
 * get_invoice_pdf saves the PDF in the outbox with its SHA-256 instead of
 * answering with its base64. The PDF here is a few invented bytes.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { connect, json, keyFiles, stubFetch } from "./harness.js";

const API = "https://api.porkbun.com/api/json/v3";
const PDF = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n", "latin1");
const outbox = () => mkdtempSync(join(tmpdir(), "porkbun-outbox-"));

/** What GET /account/invoicePdf/{id} answers, with these bytes. */
const answer = (bytes: Buffer, extra: Record<string, unknown> = {}) => ({
  status: "SUCCESS",
  filename: "porkbun-invoice-4242.pdf",
  contentType: "application/pdf",
  sizeBytes: bytes.length,
  contentBase64: bytes.toString("base64"),
  downloadUrl: "https://porkbun.com/invoice/download/example-token",
  downloadExpires: "2026-10-22T13:15:00Z",
  ...extra,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("get_invoice_pdf", () => {
  it("saves the PDF in the outbox and answers with its path, size and sha256, never the content", async () => {
    const dir = outbox();
    const sent = stubFetch(() => json(answer(PDF)));
    const { call } = await connect({ ...keyFiles(), PORKBUN_OUTBOX_DIR: dir });
    const result = await call("get_invoice_pdf", { invoice_id: 4242 });
    const path = join(dir, "porkbun-invoice-4242.pdf");
    expect(result.value).toEqual({
      status: "SUCCESS",
      filename: "porkbun-invoice-4242.pdf",
      contentType: "application/pdf",
      sizeBytes: PDF.length,
      downloadUrl: "https://porkbun.com/invoice/download/example-token",
      downloadExpires: "2026-10-22T13:15:00Z",
      file: { path, size: PDF.length, sha256: createHash("sha256").update(PDF).digest("hex"), contentType: "application/pdf" },
    });
    expect(result.text).not.toContain(PDF.toString("base64"));
    expect(readFileSync(path).equals(PDF)).toBe(true);
    expect(sent.map((s) => `${s.method} ${s.url}`)).toEqual([`GET ${API}/account/invoicePdf/4242`]);
  });

  it("saves into a folder inside the outbox, names a file Porkbun named oddly after the invoice, and refuses a folder outside", async () => {
    const dir = outbox();
    stubFetch(() => json(answer(PDF, { filename: "../../etc/passwd" })));
    const { call } = await connect({ ...keyFiles(), PORKBUN_OUTBOX_DIR: dir });
    const inside = await call("get_invoice_pdf", { invoice_id: 7, save_dir: "2026-10" });
    expect(inside.value).toMatchObject({ file: { path: join(dir, "2026-10", "porkbun-invoice-7.pdf") } });
    const outside = await call("get_invoice_pdf", { invoice_id: 7, save_dir: "/etc" });
    expect(outside.value).toMatchObject({ error: { kind: "input", message: expect.stringContaining("save_dir must be a folder under") } });
  });

  it.each([
    ["no content", { contentBase64: undefined }, "no contentBase64"],
    ["base64 that is not", { contentBase64: "not base64!" }, "not standard base64"],
    ["a file that is not a PDF", { contentBase64: Buffer.from("<html>sign in</html>").toString("base64"), sizeBytes: 20 }, "does not start like a PDF"],
    ["a size that disagrees", { sizeBytes: PDF.length + 1 }, `says the file is ${String(PDF.length + 1)} bytes`],
  ])("saves nothing on %s", async (_why, change, message) => {
    const dir = outbox();
    stubFetch(() => json(answer(PDF, change)));
    const { call } = await connect({ ...keyFiles(), PORKBUN_OUTBOX_DIR: dir });
    const result = await call("get_invoice_pdf", { invoice_id: 9 });
    expect(result.value).toMatchObject({ error: { kind: "drift", message: expect.stringContaining(message) } });
    expect(readdirSync(dir)).toEqual([]);
  });

  it("without an outbox answers config and sends nothing", async () => {
    const sent = stubFetch(() => json(answer(PDF)));
    const { call } = await connect(keyFiles());
    const result = await call("get_invoice_pdf", { invoice_id: 9 });
    expect(result.value).toMatchObject({ error: { kind: "config", variable: "PORKBUN_OUTBOX_DIR", remedy: expect.stringContaining("invoice PDFs") } });
    expect(sent).toEqual([]);
    expect(existsSync(join(tmpdir(), "porkbun-invoice-9.pdf"))).toBe(false);
  });
});
