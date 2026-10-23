/**
 * Rollout control through the guard, against a fake EAS that remembers each
 * update's rollout: set_rollout raises it (and repeating it changes nothing,
 * which is what its policy's `idempotent` promises), revert_rollout publishes
 * the control group again over the rollout, naming the rollout update it ends.
 */
import { connectInMemory, guard, idempotentWrites, McpServer } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import { buildDeps } from "../src/composition.js";
import { asAppError, remedyFor } from "../src/domain/errors.js";
import type { RawGroupUpdate } from "../src/domain/schema.js";
import { policyFor } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";
import { ACCOUNT_APPS, APP, ME, fakeEas, parse, tokenFile } from "./helpers.js";

const connected = async () => {
  const deps = buildDeps({ EXPO_TOKEN_FILE: tokenFile() }, { sleep: async () => undefined });
  const server = new McpServer({ name: "eas", version: "test" });
  registerAll(guard(server, { service: "eas", policy: policyFor(deps), settings: { maxAccess: "write", confirm: "client" }, log: () => undefined, vocabulary: { asAppError, remedyFor } }), deps);
  const client = await connectInMemory(server);
  return async (name: string, args: Record<string, unknown>) => parse(await client.callTool({ name, arguments: args }));
};

const COMMIT = "abcdef0123456789abcdef0123456789abcdef01";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const update = (over: Partial<RawGroupUpdate> & Pick<RawGroupUpdate, "id" | "group" | "platform">): Mutable<RawGroupUpdate> => ({
  app: { id: APP.id, fullName: APP.fullName },
  message: "fix: streak count",
  createdAt: "2026-10-20T09:00:00.000Z",
  manifestFragment: '{"launchAsset":{}}',
  isRollBackToEmbedded: false,
  gitCommitHash: COMMIT,
  isGitWorkingTreeDirty: false,
  environment: "production",
  manifestHostOverride: null,
  assetHostOverride: null,
  runtime: { version: "1.4.0" },
  branch: { id: "b-prod", name: "production" },
  codeSigningInfo: null,
  rolloutPercentage: null,
  rolloutControlUpdate: null,
  fingerprint: null,
  ...over,
});

/** The control group (before), and a rollout group on top of it at 10% for both platforms. */
const groups = (): Record<string, Mutable<RawGroupUpdate>[]> => ({
  "g-before": [update({ id: "u-ios-0", group: "g-before", platform: "ios", message: "feat: weekly view" }), update({ id: "u-and-0", group: "g-before", platform: "android", message: "feat: weekly view" })],
  "g-roll": [
    update({ id: "u-ios-1", group: "g-roll", platform: "ios", rolloutPercentage: 10, rolloutControlUpdate: { id: "u-ios-0", group: "g-before" } }),
    update({ id: "u-and-1", group: "g-roll", platform: "android", rolloutPercentage: 10, rolloutControlUpdate: { id: "u-and-0", group: "g-before" } }),
  ],
});

/** A fake EAS holding the groups, whose SetRollout changes what UpdateGroup answers next. */
const easOf = (state: Record<string, Mutable<RawGroupUpdate>[]>, latest: Record<string, { id: string; group: string }> = { ios: { id: "u-ios-1", group: "g-roll" }, android: { id: "u-and-1", group: "g-roll" } }) =>
  fakeEas({
    Me: () => ME,
    AccountApps: () => ACCOUNT_APPS,
    UpdateGroup: (v) => ({ updatesByGroup: state[String(v["group"])] ?? [] }),
    Updates: () => ({
      app: { byId: { updateChannels: [{ id: "c1", name: "production", isPaused: false, isProtected: false, branchMapping: JSON.stringify({ data: [{ branchId: "b-prod" }] }) }], updateBranches: [] } },
    }),
    SetRollout: (v) => {
      const found = Object.values(state).flat().find((u) => u.id === v["updateId"]);
      if (found === undefined) throw new Error("no such update");
      found.rolloutPercentage = Number(v["percentage"]);
      return { update: { setRolloutPercentage: { id: found.id, platform: found.platform, rolloutPercentage: found.rolloutPercentage } } };
    },
    LatestOnBranch: (v) => {
      const platform = String((v["filter"] as { platform: string }).platform).toLowerCase();
      const hit = latest[platform];
      return { app: { byId: { updateBranchByName: { updates: hit === undefined ? [] : [hit] } } } };
    },
    PublishGroup: () => ({ updateBranch: { publishUpdateGroups: [{ id: "u-ios-2", group: "g-back", platform: "ios" }, { id: "u-and-2", group: "g-back", platform: "android" }] } }),
  });

describe("set_rollout", () => {
  it("raises every platform of the rollout to the percentage, naming the production channels it reaches", async () => {
    const calls = easOf(groups());
    const out = await (await connected())("set_rollout", { group: "g-roll", percentage: 50 });
    expect(out).toMatchObject({ project: APP.fullName, group: "g-roll", branch: "production", productionChannels: ["production"], changed: true, previousPercentage: 10, rolloutPercentage: 50 });
    expect(out.updates).toEqual([
      { id: "u-ios-1", platform: "ios", rolloutPercentage: 50 },
      { id: "u-and-1", platform: "android", rolloutPercentage: 50 },
    ]);
    expect(calls.filter((c) => c.operation === "SetRollout").map((c) => c.variables)).toEqual([
      { updateId: "u-ios-1", percentage: 50 },
      { updateId: "u-and-1", percentage: 50 },
    ]);
  });

  it("is declared idempotent, and the same percentage twice sends EAS one change", async () => {
    expect(idempotentWrites(policyFor(buildDeps({})))).toEqual(["set_rollout"]);
    const calls = easOf(groups());
    const call = await connected();
    await call("set_rollout", { group: "g-roll", percentage: 100, platform: "ios" });
    const again = await call("set_rollout", { group: "g-roll", percentage: 100, platform: "ios" });
    expect(again).toMatchObject({ changed: false, rolloutPercentage: 100 });
    expect(calls.filter((c) => c.operation === "SetRollout")).toHaveLength(1);
  });

  it("refuses to lower a rollout, to start one, and to move a group of another project, changing nothing", async () => {
    const state = groups();
    state["g-roll"] = state["g-roll"]!.map((u) => ({ ...u, rolloutPercentage: 40 }));
    state["g-other"] = [update({ id: "u-x", group: "g-other", platform: "ios", app: { id: "other-app", fullName: "@acme/other" }, rolloutPercentage: 5, rolloutControlUpdate: { id: "u-y", group: "g-y" } })];
    const calls = easOf(state);
    const call = await connected();
    expect((await call("set_rollout", { group: "g-roll", percentage: 20 })).error).toMatchObject({ kind: "input", message: expect.stringContaining("a rollout only grows") });
    expect((await call("set_rollout", { group: "g-before", percentage: 20 })).error).toMatchObject({ kind: "input", message: expect.stringContaining("is not in a rollout") });
    expect((await call("set_rollout", { group: "g-other", percentage: 20 })).error).toMatchObject({ kind: "input", message: expect.stringContaining("belongs to @acme/other") });
    expect(calls.some((c) => c.operation === "SetRollout")).toBe(false);
  });

  it("answers 100 on a group in no rollout as already out, and different percentages per platform as a question", async () => {
    const state = groups();
    state["g-roll"] = [{ ...state["g-roll"]![0]!, rolloutPercentage: 10 }, { ...state["g-roll"]![1]!, rolloutPercentage: 30 }];
    const calls = easOf(state);
    const call = await connected();
    expect(await call("set_rollout", { group: "g-before", percentage: 100 })).toMatchObject({ changed: false, rolloutPercentage: null });
    expect((await call("set_rollout", { group: "g-roll", percentage: 50 })).error).toMatchObject({ message: expect.stringContaining("ios 10%, android 30%") });
    expect((await call("set_rollout", { group: "g-roll", percentage: 50, platform: "android" })).updates).toEqual([{ id: "u-and-1", platform: "android", rolloutPercentage: 50 }]);
    expect(calls.filter((c) => c.operation === "SetRollout")).toHaveLength(1);
  });
});

describe("revert_rollout", () => {
  it("publishes the control group on the branch again, ending each platform's rollout update by name", async () => {
    const calls = easOf(groups());
    const out = await (await connected())("revert_rollout", { group: "g-roll" });
    expect(out).toMatchObject({
      branch: "production",
      productionChannels: ["production"],
      reverted: { group: "g-roll", rolloutPercentage: 10, platforms: ["ios", "android"] },
      republished: [{ from: "g-before", platforms: ["ios", "android"] }],
    });
    const published = calls.filter((c) => c.operation === "PublishGroup");
    expect(published).toHaveLength(1);
    expect(published[0]?.variables).toMatchObject({
      input: [
        {
          branchId: "b-prod",
          runtimeVersion: "1.4.0",
          message: "Revert of rollout g-roll: back to group g-before: feat: weekly view",
          updateInfoGroup: { ios: { launchAsset: {} }, android: { launchAsset: {} } },
          previousRolloutUpdateToClobberIdGroup: { ios: "u-ios-1", android: "u-and-1" },
        },
      ],
    });
  });

  it("refuses a rollout something newer already ended, and one with no update before it, publishing nothing", async () => {
    const ended = easOf(groups(), { ios: { id: "u-ios-2", group: "g-back" }, android: { id: "u-and-2", group: "g-back" } });
    const call = await connected();
    expect((await call("revert_rollout", { group: "g-roll" })).error).toMatchObject({ kind: "input", message: expect.stringContaining("has already ended on production for runtime 1.4.0: group g-back") });
    expect(ended.some((c) => c.operation === "PublishGroup")).toBe(false);

    const state = groups();
    state["g-first"] = [update({ id: "u-f", group: "g-first", platform: "ios", rolloutPercentage: 25, rolloutControlUpdate: null })];
    const first = easOf(state, { ios: { id: "u-f", group: "g-first" } });
    expect((await call("revert_rollout", { group: "g-first" })).error).toMatchObject({ kind: "input", message: expect.stringContaining("embedded in the app") });
    expect(first.some((c) => c.operation === "PublishGroup")).toBe(false);
  });

  it("refuses a code-signed control group, which this server cannot sign again", async () => {
    const state = groups();
    state["g-before"] = state["g-before"]!.map((u) => ({ ...u, codeSigningInfo: { keyid: "main", alg: "rsa-v1_5-sha256" } }));
    const calls = easOf(state);
    expect((await (await connected())("revert_rollout", { group: "g-roll" })).error).toMatchObject({ kind: "input", message: expect.stringContaining("code-signed") });
    expect(calls.some((c) => c.operation === "PublishGroup")).toBe(false);
  });
});
