import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeErrorKit } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import { joinErrors } from "../src/domain/index.js";
import { credentialsReader, envPrefix, makeFiles, makeOrderStore, resolvePaths, resolveTimeZone } from "../src/infra/index.js";

const temp = () => mkdtemp(join(tmpdir(), "receipts-"));
const { asAppError } = joinErrors(makeErrorKit<never>("test"));

describe("makeOrderStore", () => {
  it("round-trips an order, private to the user, and counts it", async () => {
    const dir = join(await temp(), "orders");
    const store = makeOrderStore<{ readonly id: number }>(dir);
    expect(await store.read(1)).toBeUndefined();
    expect(await store.count()).toBe(0);
    await store.write(1, { id: 1 });
    expect(await store.read(1)).toEqual({ id: 1 });
    expect(await store.count()).toBe(1);
    expect((await stat(join(dir, "1.json"))).mode & 0o777).toBe(0o600);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect(await readdir(dir)).toEqual(["1.json"]);
  });

  it("reads a file that does not parse as absent, so it is fetched again", async () => {
    const dir = await temp();
    await writeFile(join(dir, "2.json"), "{half");
    expect(await makeOrderStore(dir).read(2)).toBeUndefined();
  });
});

describe("makeFiles", () => {
  it("writes an export readable by the owner and the group only, and says what it wrote: path, sha256 and size", async () => {
    const dir = join(await temp(), "exports");
    const written = await makeFiles().writeText(dir, "a.csv", "ș\n");
    const bytes = await readFile(written.path);
    expect(written).toEqual({ path: join(dir, "a.csv"), sha256: createHash("sha256").update(bytes).digest("hex"), size: 3 });
    expect(bytes.toString("utf8")).toBe("ș\n");
    // 0640 like every other outbox file in this repository: a deployment lets the reader in by group.
    expect((await stat(written.path)).mode & 0o777).toBe(0o640);
  });
});

describe("resolvePaths", () => {
  it("names every variable after the server", () => {
    expect(envPrefix("bolt-food")).toBe("BOLT_FOOD");
    expect(resolvePaths("bolt-food", { BOLT_FOOD_CREDS: "/c.json", BOLT_FOOD_STATE_DIR: "/srv/bolt-food", BOLT_FOOD_EXPORTS_DIR: "/out" })).toEqual({
      credentials: { variable: "BOLT_FOOD_CREDS", path: "/c.json" },
      stateDir: "/srv/bolt-food",
      ordersDir: "/srv/bolt-food/orders",
      exportsDir: "/out",
    });
  });

  it("gives credentials no default, keeps state where the kit keeps every server's, and exports under it", () => {
    const state = join("/home/u/.local/state", "mcps/glovo");
    expect(resolvePaths("glovo", { HOME: "/home/u", GLOVO_CREDS: " ", GLOVO_EXPORTS_DIR: " " })).toEqual({
      credentials: { variable: "GLOVO_CREDS", path: undefined },
      stateDir: state,
      ordersDir: join(state, "orders"),
      exportsDir: join(state, "exports"),
    });
    expect(resolvePaths("glovo", { STATE_DIRECTORY: "/var/lib/glovo" }).stateDir).toBe("/var/lib/glovo");
    expect(resolvePaths("glovo", { GLOVO_STATE_DIR: "/s" }).exportsDir).toBe("/s/exports");
  });
});

describe("resolveTimeZone", () => {
  it("is the server's own variable, else the process's zone, and refuses a zone that does not exist", () => {
    expect(resolveTimeZone("bolt-food", { BOLT_FOOD_TIME_ZONE: "Europe/Bucharest" })).toBe("Europe/Bucharest");
    expect(resolveTimeZone("bolt-food", {})).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(() => resolveTimeZone("glovo", { GLOVO_TIME_ZONE: "Mars/Olympus" })).toThrow("GLOVO_TIME_ZONE");
  });
});

describe("credentialsReader", () => {
  const read = credentialsReader({ refreshToken: "refresh_token", deviceId: "device_id" });

  const at = (path: string | undefined) => ({ variable: "X_CREDS", path });

  it("reads the fields under the names the code uses", async () => {
    const path = join(await temp(), "credentials.json");
    await writeFile(path, JSON.stringify({ refresh_token: "r", device_id: "d", extra: 1 }));
    expect(await read(at(path))).toEqual({ refreshToken: "r", deviceId: "d" });
  });

  it("is a config failure naming the variable when none is set", async () => {
    expect(asAppError(await read(at(undefined)).catch((e: unknown) => e))).toEqual({
      kind: "config",
      message: "X_CREDS is not set; this server has no default location",
    });
  });

  it("is a config failure naming the missing fields, never the values", async () => {
    const dir = await temp();
    await writeFile(join(dir, "partial.json"), JSON.stringify({ refresh_token: "secret-value" }));
    await writeFile(join(dir, "null.json"), "null");
    const partial = asAppError(await read(at(join(dir, "partial.json"))).catch((e: unknown) => e));
    expect(partial).toMatchObject({ kind: "config" });
    expect(partial?.message).toContain("lack: device_id");
    expect(partial?.message).not.toContain("secret-value");
    expect(asAppError(await read(at(join(dir, "null.json"))).catch((e: unknown) => e))).toMatchObject({ kind: "config" });
    expect(asAppError(await read(at(join(dir, "absent.json"))).catch((e: unknown) => e))).toMatchObject({ kind: "config", message: expect.stringContaining("cannot be read (ENOENT)") });
  });

  it("does not quote a file that is not JSON, which may be a token pasted bare", async () => {
    const path = join(await temp(), "credentials.json");
    await writeFile(path, "eyJhbGciOiJIUzI1NiJ9.secret-token-value");
    const error = asAppError(await read(at(path)).catch((e: unknown) => e));
    expect(error).toMatchObject({ kind: "config", message: `credentials at ${path} (X_CREDS) are not JSON` });
    expect(error?.message).not.toContain("eyJhbGci");
  });
});
