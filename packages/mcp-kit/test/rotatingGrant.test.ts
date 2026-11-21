import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { Granted } from "../src/oauth.js";
import { grantAfterRefresh, makeGrantSource, type RotatingGrant } from "../src/rotatingGrant.js";
import { storedFile } from "../src/storedFile.js";

const onDisk = z.object({ access: z.string(), refresh: z.string(), exp: z.number() });
const setup = async (initial: RotatingGrant | undefined, refresh: (token: string) => Promise<Granted>, clock = { t: 1000 }) => {
  const path = join(await mkdtemp(join(tmpdir(), "kit-rotating-")), "grant.json");
  const store = storedFile<RotatingGrant, z.infer<typeof onDisk>>(path, {
    schema: onDisk,
    fromDisk: (d) => ({ accessToken: d.access, refreshToken: d.refresh, expiresAtEpoch: d.exp }),
    toDisk: (g) => ({ access: g.accessToken, refresh: g.refreshToken, exp: g.expiresAtEpoch }),
  });
  if (initial !== undefined) await store.write(initial);
  const source = makeGrantSource({
    store,
    path,
    lockName: "grant.lock",
    refresh,
    missing: () => {
      throw new Error("no grant");
    },
    nowEpoch: () => clock.t,
  });
  return { source, store, clock };
};
const granted = (access: string, refresh: string | undefined, expiresInSeconds = 3600): Granted => ({ accessToken: access, expiresInSeconds, ...(refresh === undefined ? {} : { refreshToken: refresh }), raw: {} });

describe("makeGrantSource", () => {
  it("hands out a fresh access token without refreshing", async () => {
    const { source } = await setup({ accessToken: "a1", refreshToken: "r1", expiresAtEpoch: 5000 }, async () => {
      throw new Error("must not refresh");
    });
    expect(await source.get()).toBe("a1");
  });

  it("refreshes a token near expiry and persists the rotated pair before returning it", async () => {
    const seen: string[] = [];
    const { source, store } = await setup({ accessToken: "a1", refreshToken: "r1", expiresAtEpoch: 1030 }, async (token) => {
      seen.push(token);
      return granted("a2", "r2");
    });
    expect(await source.get()).toBe("a2");
    expect(seen).toEqual(["r1"]);
    expect(await store.read()).toEqual({ accessToken: "a2", refreshToken: "r2", expiresAtEpoch: 4600 });
  });

  it("spends a refresh token once however many callers are waiting", async () => {
    const seen: string[] = [];
    const { source } = await setup({ accessToken: "a1", refreshToken: "r1", expiresAtEpoch: 900 }, async (token) => {
      seen.push(token);
      await new Promise((r) => setTimeout(r, 20));
      return granted("a2", "r2");
    });
    expect(await Promise.all([source.get(), source.get(), source.get(), source.force()])).toEqual(["a2", "a2", "a2", "a2"]);
    expect(seen).toEqual(["r1"]);
  });

  it("force replaces a token the upstream refused, even if it looks fresh", async () => {
    const { source } = await setup({ accessToken: "a1", refreshToken: "r1", expiresAtEpoch: 9000 }, async () => granted("a2", "r2"));
    expect(await source.force()).toBe("a2");
    expect(await source.get()).toBe("a2");
  });

  it("keeps the old refresh token when the provider does not rotate it, and says when there is no grant", async () => {
    expect(grantAfterRefresh({ accessToken: "a", refreshToken: "r1", expiresAtEpoch: 1 }, granted("b", undefined), 10)).toEqual({ accessToken: "b", refreshToken: "r1", expiresAtEpoch: 3610 });
    const { source } = await setup(undefined, async () => granted("x", "y"));
    await expect(source.get()).rejects.toThrow("no grant");
  });

  it("writes nothing when the refresh fails, so the old refresh token stays", async () => {
    const { source, store } = await setup({ accessToken: "a1", refreshToken: "r1", expiresAtEpoch: 900 }, async () => {
      throw new Error("invalid_grant");
    });
    await expect(source.get()).rejects.toThrow("invalid_grant");
    expect((await store.read())?.refreshToken).toBe("r1");
  });
});
