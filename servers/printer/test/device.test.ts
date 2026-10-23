/**
 * The device transport against a real TLS server on loopback, with a
 * certificate made for the run (no key is stored): the pinned certificate is
 * accepted, any other is refused before a request byte is sent, and the
 * refusal names the fingerprint the device showed.
 */
import { X509Certificate } from "node:crypto";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { testCertificate } from "../../../packages/mcp-kit/testing/certificate.js";
import { asAppError } from "../src/domain/errors.js";
import { makeDeviceHttp, normaliseFingerprint } from "../src/infra/device.js";

const cert = testCertificate("printer.example", new Date(Date.now() + 365 * 86_400_000));
const fingerprint = normaliseFingerprint(new X509Certificate(cert.pem).fingerprint256);

let server: Server;
let base: URL;
const seen: string[] = [];

beforeAll(async () => {
  server = createServer({ cert: cert.pem, key: cert.keyPem }, (req, res) => {
    seen.push(`${req.method} ${req.url}`);
    // every answer closes its connection, so each request is a new TLS connection that may resume a session
    res.writeHead(200, { "content-type": "text/plain", location: "/eSCL/ScanJobs/1", connection: "close" });
    res.end("hello");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = new URL(`https://127.0.0.1:${(server.address() as AddressInfo).port}/eSCL/ScannerStatus`);
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const failureOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (thrown) {
    return asAppError(thrown);
  }
  throw new Error("expected a failure");
};

describe("the device transport", () => {
  it("talks to a device whose certificate is the one pinned", async () => {
    const http = makeDeviceHttp({ pin: fingerprint, device: "scanner" });
    const response = await http(base, { timeoutMs: 5_000 });
    expect(response.status).toBe(200);
    expect(Buffer.from(response.body).toString()).toBe("hello");
    expect(response.headers.get("location")).toBe("/eSCL/ScanJobs/1");
  });

  it("checks the certificate on every new connection: a resumed TLS session, which shows none, is never offered", async () => {
    const http = makeDeviceHttp({ pin: fingerprint, device: "printer" });
    for (let i = 0; i < 4; i += 1) expect((await http(base, { timeoutMs: 5_000 })).status).toBe(200);
  });

  it("refuses any other certificate before sending anything, naming the one shown", async () => {
    seen.length = 0;
    const wrong = makeDeviceHttp({ pin: "00".repeat(32), device: "printer" });
    expect(await failureOf(wrong(base, { method: "POST", body: "secret", timeoutMs: 5_000 }))).toEqual({
      kind: "tls",
      sha256: fingerprint,
      message: `the device's certificate is not the one pinned (it shows ${fingerprint})`,
    });
    const unpinned = makeDeviceHttp({ device: "printer" });
    expect(await failureOf(unpinned(base, { timeoutMs: 5_000 }))).toMatchObject({ kind: "tls", sha256: fingerprint, message: expect.stringContaining("none is pinned") });
    expect(seen).toEqual([]);
  });

  it("says which device could not be reached, and keeps to the egress allowlist", async () => {
    const http = makeDeviceHttp({ pin: fingerprint, device: "printer" });
    const closed = new URL("http://127.0.0.1:9/ipp/print");
    expect(await failureOf(http(closed, { timeoutMs: 5_000 }))).toMatchObject({ kind: "unreachable", device: "printer" });
    const fenced = makeDeviceHttp({ pin: fingerprint, device: "printer", egress: ["printer.example"] });
    expect(await failureOf(fenced(base, { timeoutMs: 5_000 }))).toMatchObject({ kind: "config", variable: "MCP_EGRESS_ALLOW" });
  });
});
