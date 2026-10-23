/**
 * deploy_site takes its files by path (or base64 a script wrote, with its
 * sha256), reads them here, and hands the vendor's tool the base64 of exactly
 * those bytes: a model never retypes a file.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ToolSpec } from "../src/app/ports.js";
import { buildDeps } from "../src/composition.js";
import { deploySiteTool } from "../src/mcp/register/deploySite.js";
import { connect, json, keyFiles, stubFetch } from "./harness.js";

const API = "https://api.porkbun.com/api/json/v3";

afterEach(() => {
  vi.unstubAllGlobals();
});

const site = () => {
  const root = mkdtempSync(join(tmpdir(), "porkbun-site-"));
  const page = Buffer.from("<!doctype html><title>Exemplu</title>\n");
  const style = Buffer.from([0xef, 0xbb, 0xbf, 0x62, 0x6f, 0x64, 0x79, 0x7b, 0x7d]); // a BOM, then body{}
  writeFileSync(join(root, "index.html"), page);
  writeFileSync(join(root, "style.css"), style);
  return { root, page, style };
};

const sha = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

describe("deploy_site", () => {
  it("reads each file from the roots and sends the vendor the base64 of exactly those bytes, saying what was sent", async () => {
    const { root, page, style } = site();
    const sent = stubFetch(() => json({ status: "SUCCESS", uploaded: 2 }));
    const { call } = await connect({ ...keyFiles(), MCP_FILE_ROOTS: root });
    const result = await call("deploy_site", {
      domain: "example.com",
      files: [
        { path: "index.html", local_path: join(root, "index.html") },
        { path: "assets/style.css", local_path: "style.css", sha256: sha(style) },
      ],
    });
    expect(result.isError).toBe(false);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ url: `${API}/hosting/deploy/example.com`, method: "POST" });
    expect((sent[0]?.body as { files: unknown }).files).toEqual([
      { path: "index.html", content: page.toString("base64") },
      { path: "assets/style.css", content: style.toString("base64") },
    ]);
    expect(result.value).toEqual({
      status: "SUCCESS",
      uploaded: 2,
      sent_files: [
        { path: "index.html", sha256: sha(page), size: page.length },
        { path: "assets/style.css", sha256: sha(style), size: style.length },
      ],
    });
  });

  it("takes base64 only with the source's sha256, and uploads nothing when a file is wrong", async () => {
    const { root, page } = site();
    const sent = stubFetch(() => json({ status: "SUCCESS" }));
    const { call } = await connect({ ...keyFiles(), MCP_FILE_ROOTS: root });
    const content_base64 = page.toString("base64");

    const unsigned = await call("deploy_site", { domain: "example.com", files: [{ path: "index.html", content_base64 }] });
    expect(unsigned.value).toMatchObject({ error: { kind: "input", code: "sha256_required" } });

    const changed = await call("deploy_site", { domain: "example.com", files: [{ path: "a.html", content_base64, sha256: sha(page) }, { path: "b.html", content_base64, sha256: "0".repeat(64) }] });
    expect(changed.value).toMatchObject({ error: { kind: "checksum_mismatch" } });

    const outside = await call("deploy_site", { domain: "example.com", files: [{ path: "x.html", local_path: "/etc/hostname" }] });
    expect(outside.value).toMatchObject({ error: { kind: "input", code: "outside_roots" } });

    expect(sent).toEqual([]);

    const fine = await call("deploy_site", { domain: "example.com", files: [{ path: "index.html", content_base64, sha256: sha(page) }] });
    expect(fine.isError).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it("stops the server when the vendor's tool no longer takes files as [{ path, content }]", async () => {
    const { z } = await import("zod");
    const deps = buildDeps({});
    const vendor = deps.porkbun.catalog.find((t) => t.name === "deploy_site") as ToolSpec;
    expect(() => deploySiteTool(deps, vendor, false)).not.toThrow();
    const changed: ToolSpec = { ...vendor, inputSchema: { domain: z.string(), files: z.array(z.object({ path: z.string(), data: z.string() })) } };
    expect(() => deploySiteTool(deps, changed, false)).toThrow(/deploy_site no longer takes/);
  });
});
