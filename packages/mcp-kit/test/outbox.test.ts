import { createHash } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { makeHandled } from "../src/envelope.js";
import { makeErrorKit } from "../src/errors.js";
import { noteHandedBack, saveToOutbox } from "../src/handedBack.js";
import { mimeTypeOf, resolveSaveDir, resourceLinkTo } from "../src/outbox.js";

describe("resolveSaveDir", () => {
  const root = "/srv/outbox/google/work/";

  it("is the account's folder by default, and a folder inside it on request", () => {
    expect(resolveSaveDir(root, undefined)).toEqual({ ok: true, dir: "/srv/outbox/google/work" });
    expect(resolveSaveDir(root, "  ")).toEqual({ ok: true, dir: "/srv/outbox/google/work" });
    expect(resolveSaveDir(root, "2026-09//invoices/./")).toEqual({ ok: true, dir: "/srv/outbox/google/work/2026-09/invoices" });
    expect(resolveSaveDir(root, "/srv/outbox/google/work/x")).toEqual({ ok: true, dir: "/srv/outbox/google/work/x" });
  });

  it("refuses anywhere else, and climbing out", () => {
    expect(resolveSaveDir(root, "/home/user/Documents/Accounting")).toMatchObject({ ok: false, reason: expect.stringMatching(/under \/srv\/outbox\/google\/work/) });
    expect(resolveSaveDir(root, "/srv/outbox/google/workshop")).toMatchObject({ ok: false });
    expect(resolveSaveDir(root, "a/../../personal")).toMatchObject({ ok: false, reason: expect.stringMatching(/\.\./) });
  });
});

describe("resourceLinkTo", () => {
  it("links a saved file by a file:// URI, with its name, type and size", () => {
    expect(resourceLinkTo("/var/out/2026-09/invoice 7.pdf", 1234)).toEqual({
      type: "resource_link",
      uri: "file:///var/out/2026-09/invoice%207.pdf",
      name: "invoice 7.pdf",
      mimeType: "application/pdf",
      size: 1234,
    });
  });

  it("escapes what a URI cannot carry, and leaves out a type it does not know", () => {
    const link = resourceLinkTo("/out/a#b?c%d.weird", 0);
    expect(link.uri).toBe("file:///out/a%23b%3Fc%25d.weird");
    expect(link).not.toHaveProperty("mimeType");
    expect(mimeTypeOf("EXPORT.CSV")).toBe("text/csv");
    expect(mimeTypeOf(".hidden")).toBeUndefined();
  });
});

describe("files handed back", () => {
  type E = { kind: "broken"; message: string };
  const kit = makeErrorKit<E>("outbox-test");
  const handled = makeHandled<E>({ asAppError: kit.asAppError, remedyFor: () => "fix it" });

  it("are linked after the JSON of the call that saved them, once each", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-kit-outbox-"));
    const result = await handled(async () => {
      const a = await saveToOutbox(dir, "rows.csv", "a,b\n1,2\n");
      noteHandedBack(a.path, a.size);
      const b = await saveToOutbox(join(dir, "sub"), "scan.png", new Uint8Array([1, 2, 3]));
      return { files: [a, b] };
    })();
    const [json, ...links] = result.content;
    const reported = JSON.parse(json.text) as { files: { path: string; sha256: string; size: number }[] };
    expect(reported.files.map((f) => f.size)).toEqual([8, 3]);
    expect(reported.files[0]?.sha256).toBe(createHash("sha256").update("a,b\n1,2\n").digest("hex"));
    expect(links).toEqual([
      { type: "resource_link", uri: `file://${join(dir, "rows.csv")}`, name: "rows.csv", mimeType: "text/csv", size: 8 },
      { type: "resource_link", uri: `file://${join(dir, "sub", "scan.png")}`, name: "scan.png", mimeType: "image/png", size: 3 },
    ]);
    expect((await stat(join(dir, "rows.csv"))).mode & 0o777).toBe(0o640);
    await rm(dir, { recursive: true, force: true });
  });

  it("are not linked from a call that failed, nor from another call", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-kit-outbox-"));
    const failed = await handled(async () => {
      await saveToOutbox(dir, "half.csv", "x");
      return kit.fail({ kind: "broken", message: "after the save" });
    })();
    expect(failed.isError).toBe(true);
    expect(failed.content).toHaveLength(1);
    await saveToOutbox(dir, "outside.csv", "x");
    expect((await handled(async () => ({ ok: true }))()).content).toHaveLength(1);
    await rm(dir, { recursive: true, force: true });
  });

  it("keep each concurrent call's files to itself", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-kit-outbox-"));
    const call = (name: string) =>
      handled(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return saveToOutbox(dir, name, name);
      })();
    const [a, b] = await Promise.all([call("a.txt"), call("b.txt")]);
    expect(a.content.slice(1).map((l) => (l as { name: string }).name)).toEqual(["a.txt"]);
    expect(b.content.slice(1).map((l) => (l as { name: string }).name)).toEqual(["b.txt"]);
    await rm(dir, { recursive: true, force: true });
  });
});
