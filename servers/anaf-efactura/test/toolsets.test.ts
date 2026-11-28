/**
 * ANAF_EFACTURA_TOOLSETS: unset serves every tool as before; `registry,documents`
 * is the server for anyone with no ANAF grant: it starts with an empty
 * environment, registers only tools that read, offers no parameter that needs
 * the grant, answers health without one, and hands files back inside the
 * result. The table must name every tool the server offers, and nothing else.
 */
import { connectInMemory, guard, McpServer, serve } from "@foreverworks/mcp-kit";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildDeps } from "../src/composition.js";
import { instructionsFor } from "../src/mcp/instructions.js";
import { POLICY } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";
import { ALWAYS, loadToolsets, TOOLSET_NAMES, TOOLSET_OF, toolsetGaps } from "../src/mcp/toolsets.js";
import { errorOf, json, UBL_INVOICE, withFetch } from "./fixtures.js";

afterEach(() => vi.unstubAllGlobals());

const PUBLIC = { ANAF_EFACTURA_TOOLSETS: "registry,documents" };
const PUBLIC_TOOLS = ["build_invoice", "health", "invoice_pdf", "lookup_company", "parse_invoice", "validate_invoice", "verify_signature"];
const GRANT_TOOLS = Object.keys(POLICY).filter((tool) => !PUBLIC_TOOLS.includes(tool));

/** The server as index.ts builds it with `env`, and a client of it. */
const connect = async (env: NodeJS.ProcessEnv) => {
  const { loaded, policy, mode } = loadToolsets(POLICY, env);
  const deps = buildDeps({}, { mode, now: () => 1_800_000_000, http: { sleep: async () => undefined } });
  const server = new McpServer({ name: "anaf-efactura", version: "test" }, { instructions: instructionsFor(loaded, mode) });
  registerAll(guard(server, { service: "anaf-efactura", policy, log: () => undefined }), deps, loaded);
  const client = await connectInMemory(server);
  return { client, policy, mode, tools: (await client.listTools()).tools };
};

type Content = { type: string; text?: string; resource?: { uri: string; mimeType?: string; text?: string; blob?: string } };
const call = async (client: Awaited<ReturnType<typeof connect>>["client"], name: string, args: Record<string, unknown>) => {
  const result = (await client.callTool({ name, arguments: args })) as { content: Content[]; isError?: boolean };
  return { ...result, answer: JSON.parse(result.content[0]?.text ?? "null") as Record<string, unknown> };
};

const SHA256 = async (text: string): Promise<string> => (await import("node:crypto")).createHash("sha256").update(text).digest("hex");

describe("the table against the tools offered", () => {
  it("places every tool exactly once, and names no tool that is not offered", () => {
    expect(toolsetGaps(Object.keys(POLICY))).toEqual([]);
    expect(toolsetGaps([...Object.keys(POLICY), "file_everything"])).toEqual(["offered but in no toolset (place them in src/mcp/toolsets.ts): file_everything"]);
    expect(toolsetGaps(Object.keys(POLICY).filter((tool) => tool !== "lookup_company"))).toEqual(["in a toolset but not offered (drop them): lookup_company"]);
    expect([...ALWAYS, ...Object.keys(TOOLSET_OF)].toSorted()).toEqual(Object.keys(POLICY).toSorted());
    expect(new Set(Object.values(TOOLSET_OF))).toEqual(new Set(TOOLSET_NAMES));
  });
});

describe("with the variable unset, as every deployment runs", () => {
  it("registers every tool in the policy, with every parameter, saving files to the outbox", async () => {
    for (const env of [{}, { ANAF_EFACTURA_TOOLSETS: " " }, { ANAF_EFACTURA_TOOLSETS: "all" }]) {
      const { tools, mode } = await connect(env);
      expect(tools.map((tool) => tool.name).toSorted()).toEqual(Object.keys(POLICY).toSorted());
      expect(mode).toEqual({ grantless: false, outbox: true });
      const params = (name: string) => Object.keys((tools.find((tool) => tool.name === name)?.inputSchema.properties ?? {}) as object).toSorted();
      expect(params("invoice_pdf")).toEqual(["message_id", "save_dir", "test", "validate", "xml"]);
      expect(params("verify_signature")).toEqual(["archive", "message_id", "signature", "test", "xml"]);
      expect(params("parse_invoice")).toEqual(["archive", "xml"]);
      expect(params("build_invoice")).toContain("save_dir");
    }
  });

  it("tells a client the whole story, word for word as before", () => {
    expect(instructionsFor([...TOOLSET_NAMES], { grantless: false, outbox: true })).toMatch(/^ANAF's e-Factura and e-Transport for one company: the invoices it received and sent.*begin_authorization needs the certificate holder\.$/);
  });
});

describe("a subset that needs a grant", () => {
  it("loads its toolsets and health, and says what is not there", async () => {
    const { tools, mode, policy } = await connect({ ANAF_EFACTURA_TOOLSETS: "registry, invoices" });
    expect(tools.map((tool) => tool.name).toSorted()).toEqual(["download_invoice", "health", "list_invoices", "list_invoices_window", "lookup_company", "upload_invoice", "upload_invoice_b2c", "upload_status"]);
    expect(Object.keys(policy).toSorted()).toEqual(tools.map((tool) => tool.name).toSorted());
    expect(mode).toEqual({ grantless: false, outbox: true });
    const { loaded } = loadToolsets(POLICY, { ANAF_EFACTURA_TOOLSETS: "registry,invoices" });
    expect(instructionsFor(loaded, mode)).toContain("loads only the toolsets registry, invoices (ANAF_EFACTURA_TOOLSETS)");
    expect(instructionsFor(loaded, mode)).toContain("The tools of documents, etransport, authorization are not on this server");
  });

  it("refuses a name that is not a toolset, naming the ones there are", () => {
    expect(() => loadToolsets(POLICY, { ANAF_EFACTURA_TOOLSETS: "registry,billing" })).toThrow(
      'ANAF_EFACTURA_TOOLSETS names "billing", which is not a toolset: the toolsets are registry, documents, invoices, etransport, authorization, or all (the default)',
    );
  });
});

describe("registry,documents: the server for anyone, with no grant", () => {
  it("registers only tools that read, and none that needs a grant", async () => {
    const { tools, policy, mode } = await connect(PUBLIC);
    expect(tools.map((tool) => tool.name).toSorted()).toEqual(PUBLIC_TOOLS);
    expect(Object.values(policy).every((rule) => rule.access === "read")).toBe(true);
    expect(mode).toEqual({ grantless: true, outbox: false });
    for (const tool of GRANT_TOOLS) expect(tools.map((t) => t.name)).not.toContain(tool);
    expect(GRANT_TOOLS).toEqual(expect.arrayContaining(["upload_invoice", "etransport_file", "begin_authorization", "refresh_token", "download_invoice"]));
  });

  it("gives every tool a title and a read-only hint a directory reviews", async () => {
    const { tools } = await connect(PUBLIC);
    for (const tool of tools) {
      expect(tool.title, tool.name).toBeTruthy();
      expect(tool.annotations, tool.name).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    }
  });

  it("offers no parameter that needs the grant or an outbox", async () => {
    const { tools } = await connect(PUBLIC);
    const params = (name: string) => Object.keys((tools.find((tool) => tool.name === name)?.inputSchema.properties ?? {}) as object).toSorted();
    expect(params("invoice_pdf")).toEqual(["validate", "xml"]);
    expect(params("verify_signature")).toEqual(["signature", "xml"]);
    expect(params("parse_invoice")).toEqual(["xml"]);
    expect(params("build_invoice")).not.toContain("save_dir");
    const descriptions = tools.map((tool) => tool.description).join("\n");
    expect(descriptions).not.toMatch(/outbox|list_invoices|download_invoice|message_id/);
  });

  it("starts for anyone with an empty environment: no app.json, no state folder, no ceiling", async () => {
    const { policy } = loadToolsets(POLICY, PUBLIC);
    const { mode } = loadToolsets(POLICY, PUBLIC);
    const deps = buildDeps({}, { mode });
    const served = await serve({
      name: "anaf-efactura",
      version: "test",
      policy,
      register: (server) => registerAll(server, deps, loadToolsets(POLICY, PUBLIC).loaded),
      env: { MCP_HTTP_PORT: "0", MCP_HTTP_PUBLIC_HOSTS: "mcp.example.com", MCP_HTTP_PATH: "/anaf-efactura" },
      log: () => undefined,
    });
    await served.close();
  });

  it("refuses to start for anyone when a tool that files is loaded", async () => {
    const { policy } = loadToolsets(POLICY, { ANAF_EFACTURA_TOOLSETS: "documents,invoices" });
    await expect(
      serve({ name: "anaf-efactura", version: "test", policy, register: (server) => registerAll(server, buildDeps({}), ["documents", "invoices"]), env: { MCP_HTTP_PORT: "0", MCP_HTTP_PUBLIC_HOSTS: "mcp.example.com" }, log: () => undefined }),
    ).rejects.toThrow(/upload_invoice \(money\)/);
  });

  it("answers health from ANAF's public services, with no credential", async () => {
    const calls: string[] = [];
    withFetch(async (url) => {
      calls.push(url);
      return url.includes("/tva") ? json({ found: [], notFound: [1] }) : json({ stare: "nok", trace_id: "t" });
    });
    const { client } = await connect(PUBLIC);
    const { answer, isError } = await call(client, "health", {});
    expect(isError).toBeUndefined();
    expect(answer).toMatchObject({ ok: true, endpoints: { vatRegistry: { reachable: true }, validation: { reachable: true } } });
    expect(JSON.stringify(answer)).not.toMatch(/token|appName|app.json/i);
    expect(calls.every((url) => url.startsWith("https://webservicesp.anaf.ro/"))).toBe(true);
  });

  it("says plainly which public service did not answer, and is still a successful call", async () => {
    withFetch(async (url) => (url.includes("/tva") ? new Response("down", { status: 400 }) : json({ stare: "ok", trace_id: "t" })));
    const { client } = await connect(PUBLIC);
    const { answer, isError } = await call(client, "health", {});
    expect(isError).toBeUndefined();
    expect(answer).toMatchObject({ ok: false, endpoints: { vatRegistry: { reachable: false, error: expect.any(String) }, validation: { reachable: true } } });
  });

  it("looks a company up with no grant", async () => {
    withFetch(async () => json({ found: [], notFound: [14399840] }));
    const { client } = await connect(PUBLIC);
    const { answer, isError } = await call(client, "lookup_company", { cifs: ["14399840"] });
    expect(isError).toBeUndefined();
    expect(answer).toMatchObject({ notFound: ["14399840"] });
  });

  it("builds an invoice and hands the XML back inside the answer, never a path on a disk", async () => {
    const { BUILD_CASES } = await import("./buildCases.js");
    const { client } = await connect(PUBLIC);
    const { answer, content, isError } = await call(client, "build_invoice", BUILD_CASES["ron-standard"] as Record<string, unknown>);
    expect(isError).toBeUndefined();
    expect(answer).toMatchObject({ inline: true, name: "EXS-2026-0101.xml", bytes: expect.any(Number), sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(answer).not.toHaveProperty("path");
    expect(JSON.stringify(answer)).not.toMatch(/saved to|\/invoices/);
    expect(content).toHaveLength(2);
    const file = content[1]!;
    expect(file).toMatchObject({ type: "resource", resource: { mimeType: "application/xml", uri: "inline:///EXS-2026-0101.xml" } });
    const xml = file.resource?.text ?? "";
    expect(xml).toContain("<cbc:ID>EXS-2026-0101</cbc:ID>");
    expect(await SHA256(xml)).toBe(answer["sha256"]);
    expect(Buffer.byteLength(xml)).toBe(answer["bytes"]);
  });

  it("validates a document, and renders it as a PDF attached to the answer", async () => {
    const xml = Buffer.from(UBL_INVOICE, "utf8");
    const sha256 = await SHA256(UBL_INVOICE);
    const document = UBL_INVOICE;
    const posted: string[] = [];
    withFetch(async (url) => {
      posted.push(url);
      return url.includes("transformare") ? new Response(Buffer.from("%PDF-1.5\n%fake"), { headers: { "content-type": "application/pdf" } }) : json({ stare: "ok", trace_id: "t" });
    });
    const { client } = await connect(PUBLIC);
    const checked = await call(client, "validate_invoice", { xml: document });
    expect(checked.isError).toBeUndefined();
    expect(checked.answer).toMatchObject({ valid: true, file: { size: xml.length, sha256 } });
    const pdf = await call(client, "invoice_pdf", { xml: document });
    expect(pdf.isError).toBeUndefined();
    expect(pdf.answer).toMatchObject({ saved: true, inline: true, bytes: 14, file: { size: xml.length, sha256 } });
    expect(pdf.answer).not.toHaveProperty("path");
    expect(pdf.content[1]).toMatchObject({ type: "resource", resource: { mimeType: "application/pdf", blob: Buffer.from("%PDF-1.5\n%fake").toString("base64") } });
    expect(posted.every((url) => url.startsWith("https://webservicesp.anaf.ro/"))).toBe(true);
  });

  it("takes the XML as text, hashes it itself and answers what arrived; a seal check takes both files as text", async () => {
    withFetch(async () => json({ msg: "Fișierele încărcate au fost validate cu succes" }));
    const { client } = await connect(PUBLIC);
    const parsed = await call(client, "parse_invoice", { xml: UBL_INVOICE });
    expect(parsed.isError).toBeUndefined();
    expect(parsed.answer).toMatchObject({ file: { size: Buffer.byteLength(UBL_INVOICE), sha256: await SHA256(UBL_INVOICE) } });
    const sealed = await call(client, "verify_signature", { xml: UBL_INVOICE, signature: "<Signature/>" });
    expect(sealed.answer["error"]).toBeUndefined();
    expect(sealed.answer).toMatchObject({ source: { invoice: { sha256: await SHA256(UBL_INVOICE) }, signature: { sha256: await SHA256("<Signature/>") } } });
  });

  it("refuses text over the cap, and an object where text is asked", async () => {
    const { client } = await connect(PUBLIC);
    for (const xml of ["x".repeat(1_048_577), { path: "/etc/hostname" }, ""]) {
      const refused = (await client.callTool({ name: "validate_invoice", arguments: { xml } })) as { isError?: boolean };
      expect(refused.isError).toBe(true);
    }
  });

  it("keeps path and checked base64 only where there is a grant: text is refused there", async () => {
    const { client, tools } = await connect({});
    const xml = tools.find((tool) => tool.name === "validate_invoice")?.inputSchema.properties?.["xml"] as { type?: string };
    expect(xml.type).toBe("object");
    const refused = (await client.callTool({ name: "validate_invoice", arguments: { xml: UBL_INVOICE } })) as { isError?: boolean };
    expect(refused.isError).toBe(true);
  });

  it("answers a message_id from a caller who sends it anyway with an error that names it, not a grant failure", async () => {
    const { client } = await connect(PUBLIC);
    const pdf = (await client.callTool({ name: "invoice_pdf", arguments: { message_id: "5001" } })) as { isError?: boolean; content: Content[] };
    expect(pdf.isError).toBe(true);
    expect(pdf.content[0]?.text).toMatch(/message_id/);
    const bare = await call(client, "invoice_pdf", {});
    expect(bare.answer).toMatchObject({ error: { kind: "input", message: "give the invoice as xml: its XML text" } });
  });
});

describe("the use cases, with no grant", () => {
  it("refuse what reads the grant or an outbox, with the XML to pass instead", async () => {
    const { fakeDeps } = await import("./fixtures.js");
    const { verifySignature } = await import("../src/app/usecases/signatures.js");
    const { parseInvoice } = await import("../src/app/usecases/parse.js");
    const { absent } = await import("./fixtures.js");
    const deps = fakeDeps({ mode: { grantless: true, outbox: false } });
    const seal = { messageId: "", archive: "", xml: absent("xml"), signature: absent("signature"), test: false };
    expect(await errorOf(() => verifySignature(deps, { ...seal, messageId: "5001" }))).toMatchObject({ kind: "input", message: expect.stringContaining("message_id needs the ANAF grant") });
    expect(await errorOf(() => verifySignature(deps, { ...seal, archive: "x.zip" }))).toMatchObject({ kind: "input", message: expect.stringContaining("archive needs") });
    expect(await errorOf(() => parseInvoice(deps, { xml: absent("xml"), archive: "x.zip" }))).toMatchObject({ kind: "input", message: expect.stringContaining("archive needs") });
  });
});
