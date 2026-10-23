/**
 * get_ssl_bundle saves the certificate and its private key in the outbox,
 * owner-only, once the key is known to be the certificate's, and answers
 * with paths, hashes and what the certificate says: never the key itself.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ToolSpec } from "../src/app/ports.js";
import { buildDeps } from "../src/composition.js";
import { sslBundleTool } from "../src/mcp/register/sslBundle.js";
import { testCertificate } from "../../../packages/mcp-kit/testing/certificate.js";
import { connect, json, keyFiles, stubFetch } from "./harness.js";

const API = "https://api.porkbun.com/api/json/v3";
const NOT_AFTER = new Date("2026-12-30T12:00:00Z");

afterEach(() => {
  vi.unstubAllGlobals();
});

const outbox = () => mkdtempSync(join(tmpdir(), "porkbun-outbox-"));
const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

/** Porkbun's answer: the leaf and its issuer as the chain, the leaf's key, and the public key. */
const bundle = (over: Record<string, unknown> = {}) => {
  const ca = testCertificate("ca.example.org", new Date("2030-01-01T00:00:00Z"));
  const leaf = testCertificate("example.com", NOT_AFTER, ca.key);
  return { leaf, answer: { status: "SUCCESS", certificatechain: `${leaf.pem}\n${ca.pem}`, privatekey: leaf.keyPem, publickey: "-----BEGIN PUBLIC KEY-----\n...", ...over } };
};

describe("get_ssl_bundle", () => {
  it("saves the chain and the key, mode 0640, and answers with paths, hashes and the certificate, never the key", async () => {
    const dir = outbox();
    const { leaf, answer } = bundle();
    const sent = stubFetch(() => json(answer));
    const { call, asked } = await connect({ ...keyFiles(), PORKBUN_OUTBOX_DIR: dir });

    const result = await call("get_ssl_bundle", { domain: "Example.COM" });

    expect(result.isError).toBe(false);
    expect(asked).toEqual(["porkbun: save example.com's Porkbun TLS certificate and its PRIVATE KEY in this server's outbox"]);
    expect(sent.map((s) => s.url)).toEqual([`${API}/ssl/retrieve/example.com`]);
    expect(result.text).not.toContain("PRIVATE KEY");
    expect(result.text).not.toContain(leaf.keyPem.split("\n")[1]);
    expect(result.value).toEqual({
      domain: "example.com",
      certificate: {
        subject: "CN=example.com",
        names: ["example.com", "*.example.com"],
        issuer: "CN=Example Test CA",
        validFrom: "2026-10-01T12:00:00.000Z",
        validTo: "2026-12-30T12:00:00.000Z",
        fingerprint256: expect.stringMatching(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/),
        chainLength: 2,
      },
      files: [
        { path: join(dir, "example.com.fullchain.pem"), holds: "the certificate chain, the domain's certificate first", sha256: sha(answer.certificatechain), size: answer.certificatechain.length },
        { path: join(dir, "example.com.privkey.pem"), holds: "the private key", sha256: sha(leaf.keyPem), size: leaf.keyPem.length },
      ],
      mode: "0640",
    });
    expect(readFileSync(join(dir, "example.com.privkey.pem"), "utf8")).toBe(leaf.keyPem);
    for (const name of readdirSync(dir)) expect(statSync(join(dir, name)).mode & 0o777).toBe(0o640);
  });

  it("saves into a folder inside the outbox, and refuses one outside it", async () => {
    const dir = outbox();
    const sent = stubFetch(() => json(bundle().answer));
    const { call } = await connect({ ...keyFiles(), PORKBUN_OUTBOX_DIR: dir });

    const inside = await call("get_ssl_bundle", { domain: "example.com", save_dir: "2026-10" });
    expect((inside.value["files"] as { path: string }[])[1]?.path).toBe(join(dir, "2026-10", "example.com.privkey.pem"));

    const outside = await call("get_ssl_bundle", { domain: "example.com", save_dir: "../elsewhere" });
    expect(outside.value).toMatchObject({ error: { kind: "input" } });
    expect(sent).toHaveLength(1);
  });

  it("saves nothing when the key is not the certificate's, or a field is missing", async () => {
    const dir = outbox();
    const other = testCertificate("example.com", NOT_AFTER);
    stubFetch(() => json(bundle({ privatekey: other.keyPem }).answer));
    const { call } = await connect({ ...keyFiles(), PORKBUN_OUTBOX_DIR: dir });
    const mismatched = await call("get_ssl_bundle", { domain: "example.com" });
    expect(mismatched.value).toMatchObject({ error: { kind: "bad_bundle", message: "the private key is not the key of the chain's first certificate" } });

    stubFetch(() => json(bundle({ privatekey: undefined }).answer));
    expect((await call("get_ssl_bundle", { domain: "example.com" })).value).toMatchObject({ error: { kind: "drift", message: expect.stringContaining("privatekey") } });

    stubFetch(() => json(bundle({ certificatechain: "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n" }).answer));
    expect((await call("get_ssl_bundle", { domain: "example.com" })).value).toMatchObject({ error: { kind: "bad_bundle" } });
    expect(readdirSync(dir)).toEqual([]);
  });

  it("without an outbox, answers config naming the variable and asks Porkbun nothing", async () => {
    const sent = stubFetch(() => json(bundle().answer));
    const { call } = await connect(keyFiles());
    const result = await call("get_ssl_bundle", { domain: "example.com" });
    expect(result.value).toMatchObject({ error: { kind: "config", message: expect.stringContaining("PORKBUN_OUTBOX_DIR"), remedy: expect.stringContaining("PORKBUN_OUTBOX_DIR") } });
    expect(sent).toEqual([]);
  });

  it("stops the server if the policy no longer keeps it money", () => {
    const deps = buildDeps({});
    const vendor = deps.porkbun.catalog.find((t) => t.name === "get_ssl_bundle") as ToolSpec;
    expect(() => sslBundleTool(deps, vendor, true)).not.toThrow();
    expect(() => sslBundleTool(deps, vendor, false)).toThrow(/must keep it money/);
  });
});
