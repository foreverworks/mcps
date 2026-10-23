/**
 * upload_invoice_b2c: an invoice to a person, filed through /uploadb2c by the
 * same path as upload_invoice: the same reading, the same ledger, the same
 * confirmation line, marked B2C.
 */
import { createHash } from "node:crypto";

import { connectInMemory, guard, McpServer, sha256Of } from "@foreverworks/mcp-kit";
import { describe, expect, it, vi } from "vitest";

import { uploadConfirmationLine, uploadInvoice } from "../src/app/usecases/uploads.js";
import { refileProblem } from "../src/domain/uploadLedger.js";
import { makeUploadLedger } from "../src/infra/uploadLedger.js";
import { readInvoiceXml } from "../src/infra/xml.js";
import { POLICY } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";
import { anafStub, errorOf, fakeDeps, memoryLedger, tempDir, UBL_INVOICE } from "./fixtures.js";

const args = { xml: UBL_INVOICE, cif: "", standard: "UBL", extern: false, autofactura: false, executare: false, test: true };
const sha = createHash("sha256").update(UBL_INVOICE).digest("hex");

describe("uploadInvoice with b2c", () => {
  it("files through /uploadb2c, everything else as upload_invoice does, and says so", async () => {
    const spy = vi.fn(anafStub().uploadInvoice);
    const out = await uploadInvoice(fakeDeps({ anaf: anafStub({ uploadInvoice: spy }) }), { ...args, b2c: true });
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ b2c: true, cif: "92345672", standard: "UBL", test: true });
    expect(out).toMatchObject({ environment: "test", b2c: true, accepted: true, uploadId: "5001", sha256: sha, invoice: { payable: "1234.50" } });
    const b2b = await uploadInvoice(fakeDeps(), args);
    expect(b2b).not.toHaveProperty("b2c");
  });

  it("shares the ledger with upload_invoice: the same bytes are filed in production once, whichever endpoint", async () => {
    const spy = vi.fn(anafStub().uploadInvoice);
    const ledger = memoryLedger();
    const deps = fakeDeps({ anaf: anafStub({ uploadInvoice: spy }), uploads: ledger });
    await uploadInvoice(deps, { ...args, test: false, b2c: true });
    expect(ledger.entries.get(sha)).toMatchObject({ kind: "b2c", outcome: "accepted", uploadId: "5001" });
    expect(await errorOf(() => uploadInvoice(deps, { ...args, test: false }))).toMatchObject({ kind: "input", message: expect.stringContaining("upload 5001") });
    expect(await errorOf(() => uploadInvoice(deps, { ...args, test: false, b2c: true }))).toMatchObject({ kind: "input" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("keeps the kind on disk, and reads an entry written before kinds existed", async () => {
    const dir = tempDir("ledger");
    const ledger = makeUploadLedger(dir);
    await ledger.record({ sha256: "a".repeat(64), kind: "b2c", cif: "92345672", at: "2026-10-22T10:00:00.000Z", outcome: "accepted", uploadId: "1" });
    await ledger.record({ sha256: "b".repeat(64), cif: "92345672", at: "2026-10-22T10:00:00.000Z", outcome: "accepted", uploadId: "2" });
    expect(await ledger.find("a".repeat(64))).toMatchObject({ kind: "b2c" });
    expect((await ledger.find("b".repeat(64)))?.kind).toBeUndefined();
  });

  it("points a refused refile at the tools that can tell what happened", () => {
    const entry = { sha256: sha, cif: "92345672", at: "2026-10-22", outcome: "unknown" as const };
    expect(refileProblem({ ...entry, kind: "b2c" }, false)).toContain("check upload_status or list_invoices first");
    expect(refileProblem({ ...entry, kind: "etransport" }, false)).toContain("check etransport_status or etransport_list first");
  });
});

describe("the line a person confirms", () => {
  it("is upload_invoice's, marked B2C", () => {
    const b2b = uploadConfirmationLine(readInvoiceXml, { ...args, test: false });
    const b2c = uploadConfirmationLine(readInvoiceXml, { ...args, test: false, b2c: true });
    expect(b2c).toBe(b2b.replace("invoice EX-0042", "B2C invoice EX-0042"));
    expect(b2c).toMatch(/^FILE with ANAF e-Factura PRODUCTION .*: B2C invoice EX-0042 of 2026-09-28, buyer .*, payable 1234\.50 RON/);
  });

  it("is what the policy shows for upload_invoice_b2c, from the same resolved arguments the call runs on", () => {
    const resolved = {
      ...args,
      test: false,
      refile: false,
      xml_read: { name: "invoice.xml", size: Buffer.byteLength(UBL_INVOICE), sha256: sha },
    };
    const rule = POLICY["upload_invoice_b2c"];
    expect(rule?.access).toBe("money");
    const summary = rule !== undefined && "summary" in rule ? rule.summary : undefined;
    expect(summary?.(resolved)).toBe(uploadConfirmationLine(readInvoiceXml, { ...resolved, read: resolved.xml_read, b2c: true }));
    expect(summary?.(resolved)).toContain("B2C invoice EX-0042");
  });
});

describe("upload_invoice_b2c, through the guard", () => {
  it("is listed as money and files the bytes it was given through /uploadb2c", async () => {
    const spy = vi.fn(anafStub().uploadInvoice);
    const server = new McpServer({ name: "anaf-efactura", version: "test" });
    registerAll(guard(server, { service: "anaf-efactura", policy: POLICY, log: () => undefined }), fakeDeps({ anaf: anafStub({ uploadInvoice: spy }) }));
    const client = await connectInMemory(server);
    const listed = (await client.listTools()).tools.find((t) => t.name === "upload_invoice_b2c");
    expect(listed?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    const bytes = Buffer.from(UBL_INVOICE);
    const result = (await client.callTool({
      name: "upload_invoice_b2c",
      arguments: { xml: { content_base64: bytes.toString("base64"), sha256: sha256Of(bytes) } },
    })) as { content: { text: string }[] };
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toMatchObject({ ok: true, b2c: true, environment: "test", sha256: sha });
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ b2c: true, test: true });
    expect(spy.mock.calls[0]?.[0].xml.equals(bytes)).toBe(true);
  });
});
