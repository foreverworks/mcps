/**
 * The token: minted once, kept on disk in a TEMP state dir, shared between
 * callers and processes, and re-minted when Oblio refuses it.
 */
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { makeOblioTokens } from "../src/infra/auth.js";
import type { AppConfig } from "../src/infra/config.js";
import { errorOf, json, tempDir, withFetch } from "./helpers.js";

const NOW = 1_800_000_000;

const config: AppConfig = {
  clientId: "account@example.test",
  clientSecret: "secret",
  companyCif: "RO92345672",
  apiBase: "https://oblio.test/api",
  tokenUrl: "https://oblio.test/api/authorize/token",
};

const provider = (dir: string, clock = () => NOW) =>
  makeOblioTokens(async () => config, dir, { nowEpoch: clock, sleep: async () => undefined });

describe("the token", () => {
  it("is minted once by client credentials, and reused", async () => {
    let mints = 0;
    const calls = withFetch(async () => {
      mints += 1;
      return json({ access_token: `t${mints}`, expires_in: "3600", token_type: "Bearer" });
    });
    const token = provider(tempDir());
    await expect(token.get()).resolves.toBe("t1");
    await expect(token.get()).resolves.toBe("t1");
    expect(mints).toBe(1);
    expect(calls[0]).toMatchObject({ url: config.tokenUrl, method: "POST" });
    expect(calls[0]?.body).toBe("grant_type=client_credentials&client_id=account%40example.test&client_secret=secret");
  });

  it("is minted once for concurrent callers on a cold start", async () => {
    let mints = 0;
    withFetch(async () => {
      mints += 1;
      return json({ access_token: "t", expires_in: 3600 });
    });
    const token = provider(tempDir());
    await Promise.all([token.get(), token.get(), token.get(), token.get()]);
    expect(mints).toBe(1);
  });

  it("is written to the state dir at mode 0600 and read back by another process", async () => {
    const dir = tempDir();
    withFetch(async () => json({ access_token: "shared", expires_in: 3600 }));
    await provider(dir).get();
    expect((await stat(join(dir, "access_token.json"))).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(join(dir, "access_token.json"), "utf8"))).toEqual({
      token: "shared",
      expiresAtEpoch: NOW + 3600,
    });

    withFetch(async () => {
      throw new Error("a second process must not mint");
    });
    await expect(provider(dir).get()).resolves.toBe("shared");
  });

  it("ignores a cache file that is not the documented shape", async () => {
    const dir = tempDir();
    await writeFile(join(dir, "access_token.json"), '{"token": 42}');
    withFetch(async () => json({ access_token: "fresh", expires_in: 3600 }));
    await expect(provider(dir).get()).resolves.toBe("fresh");
  });

  it("is re-minted inside the last minute before expiry", async () => {
    let mints = 0;
    withFetch(async () => {
      mints += 1;
      return json({ access_token: `t${mints}`, expires_in: 3600 });
    });
    let clock = NOW;
    const token = provider(tempDir(), () => clock);
    await token.get();
    clock = NOW + 3600 - 30;
    await expect(token.get()).resolves.toBe("t2");
  });

  it("is re-minted when Oblio refuses it", async () => {
    let mints = 0;
    withFetch(async () => {
      mints += 1;
      return json({ access_token: `t${mints}`, expires_in: 3600 });
    });
    const token = provider(tempDir());
    await token.get();
    await expect(token.force()).resolves.toBe("t2");
    expect(mints).toBe(2);
  });

  it("calls refused credentials an auth failure, with Oblio's sentence", async () => {
    withFetch(async () => json({ error: "invalid_client", error_description: "Invalid client" }, 401));
    const error = await errorOf(() => provider(tempDir()).get());
    expect(error).toMatchObject({ kind: "auth" });
    expect(error?.message).toContain("Invalid client");
  });

  it("calls an unwell token endpoint transient, not refused", async () => {
    withFetch(async () => new Response("<html>maintenance</html>", { status: 503 }));
    expect(await errorOf(() => provider(tempDir()).get())).toMatchObject({ kind: "api", status: 503 });
  });

  it("does not cache a failed mint", async () => {
    let calls = 0;
    withFetch(async () => {
      calls += 1;
      return calls === 1 ? json({ error: "invalid_client" }, 400) : json({ access_token: "t", expires_in: 3600 });
    });
    const token = provider(tempDir());
    await expect(token.get()).rejects.toBeDefined();
    await expect(token.get()).resolves.toBe("t");
  });
});
