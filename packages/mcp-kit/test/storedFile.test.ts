import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { pendingAuthorizationFile, pendingPkceAuthorizationFile } from "../src/pendingAuthorization.js";
import { storedFile } from "../src/storedFile.js";

const dirOf = (): Promise<string> => mkdtemp(join(tmpdir(), "kit-stored-"));
const refuse = (issues: string): never => {
  throw new Error(`corrupt: ${issues}`);
};
const onDisk = z.object({ access_token: z.string().min(1), obtained_at_epoch: z.number() });
type Held = { readonly accessToken: string; readonly obtainedAtEpoch: number };
const options = {
  schema: onDisk,
  fromDisk: (d: z.infer<typeof onDisk>): Held => ({ accessToken: d.access_token, obtainedAtEpoch: d.obtained_at_epoch }),
  toDisk: (h: Held): z.infer<typeof onDisk> => ({ access_token: h.accessToken, obtained_at_epoch: h.obtainedAtEpoch }),
};

describe("storedFile", () => {
  it("writes the server's shape on disk at 0600 and reads it back mapped", async () => {
    const path = join(await dirOf(), "session.json");
    const file = storedFile(path, options);
    await file.write({ accessToken: "tok-0001", obtainedAtEpoch: 1_700_000_000 });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ access_token: "tok-0001", obtained_at_epoch: 1_700_000_000 });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await file.read()).toEqual({ accessToken: "tok-0001", obtainedAtEpoch: 1_700_000_000 });
    await file.clear();
    expect(await file.read()).toBeUndefined();
    await file.clear();
  });

  it("reads a missing file and one that is not JSON as absent", async () => {
    const path = join(await dirOf(), "session.json");
    const file = storedFile(path, { ...options, corrupt: refuse });
    expect(await file.read()).toBeUndefined();
    await writeFile(path, "{ half");
    expect(await file.read()).toBeUndefined();
  });

  it("reads JSON of the wrong shape as absent, or as the server's failure naming what is wrong without the value", async () => {
    const path = join(await dirOf(), "session.json");
    await writeFile(path, JSON.stringify({ access_token: "secret-value", obtained_at_epoch: "soon" }));
    expect(await storedFile(path, options).read()).toBeUndefined();
    const failure = await storedFile(path, { ...options, corrupt: refuse }).read().then(() => "", (e: unknown) => (e as Error).message);
    expect(failure).toMatch(/^corrupt: obtained_at_epoch: /);
    expect(failure).not.toContain("secret-value");
  });

  it("takes the named lock beside the file for a write and a clear", async () => {
    const dir = await dirOf();
    const file = storedFile(join(dir, "login.json"), { ...options, lock: "login.lock" });
    await file.write({ accessToken: "tok-0001", obtainedAtEpoch: 1 });
    expect((await stat(join(dir, "login.lock"))).isFile()).toBe(true);
  });
});

describe("pending authorization files", () => {
  it("keeps a PKCE flow under the names already on disk, and refuses one without its verifier", async () => {
    const dir = await dirOf();
    const file = pendingPkceAuthorizationFile(dir, "login");
    const pending = { state: "st-0001", verifier: "ver-0001", redirectUri: "https://app.example.com/callback", createdAtEpoch: 1_700_000_000 };
    await file.write(pending);
    expect(JSON.parse(await readFile(join(dir, "login.json"), "utf8"))).toEqual({
      state: "st-0001",
      verifier: "ver-0001",
      redirect_uri: "https://app.example.com/callback",
      created_at_epoch: 1_700_000_000,
    });
    expect(await file.read()).toEqual(pending);
    expect(await pendingAuthorizationFile(dir, "login").read()).toEqual({ state: "st-0001", redirectUri: "https://app.example.com/callback", createdAtEpoch: 1_700_000_000 });

    await pendingAuthorizationFile(dir, "login").write({ state: "st-0002", redirectUri: "https://app.example.com/callback", createdAtEpoch: 1 });
    expect(await file.read()).toBeUndefined();
    await file.clear();
    expect(await pendingAuthorizationFile(dir, "login").read()).toBeUndefined();
  });
});
