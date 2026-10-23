import type { RawBranch, RawChannel, RawGroupUpdate, RawUpdate } from "./schema.js";

/**
 * EAS Update as a reader needs it: which branch each channel serves, and per
 * branch the latest update for each platform and runtime (what a device on
 * that runtime downloads next).
 */

/**
 * A channel's branch mapping is a JSON string, `{"version": 0, "data":
 * [{"branchId": ..., "branchMappingLogic": "true"}]}`; a rollout between two
 * branches has two entries with a logic each. The branch ids, in order.
 */
export const branchIdsOf = (channel: RawChannel): readonly string[] => {
  try {
    const mapping = JSON.parse(channel.branchMapping) as { readonly data?: readonly { readonly branchId?: unknown }[] };
    return (mapping.data ?? []).map((d) => d.branchId).filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
};

/** The channels whose names make them production: `production` unless the deployment says otherwise. */
export const isProductionChannel = (name: string, production: readonly string[]): boolean => production.includes(name);

const updateView = (u: RawUpdate) => ({
  group: u.group,
  platform: u.platform,
  runtimeVersion: u.runtime.version,
  createdAt: u.createdAt,
  message: u.message === null ? null : (u.message.split("\n")[0] ?? ""),
  gitCommitHash: u.gitCommitHash,
  ...(u.rolloutPercentage === null ? {} : { rolloutPercentage: u.rolloutPercentage }),
  ...(u.isRollBackToEmbedded ? { rollBackToEmbedded: true as const } : {}),
  by: u.actor?.displayName ?? null,
});

/** Per branch, the newest update for each (platform, runtime), newest first; updates arrive newest first. */
export const latestPerRuntime = (branch: RawBranch) => {
  const seen = new Set<string>();
  const latest: ReturnType<typeof updateView>[] = [];
  for (const u of branch.updates) {
    const key = `${u.platform}\n${u.runtime.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    latest.push(updateView(u));
  }
  return latest;
};

export const updatesView = (channels: readonly RawChannel[], branches: readonly RawBranch[], production: readonly string[]) => {
  const nameOf = new Map(branches.map((b) => [b.id, b.name]));
  return {
    channels: channels.map((c) => ({
      name: c.name,
      branches: branchIdsOf(c).map((id) => nameOf.get(id) ?? id),
      ...(c.isPaused ? { paused: true as const } : {}),
      ...(c.isProtected ? { protected: true as const } : {}),
      ...(isProductionChannel(c.name, production) ? { production: true as const } : {}),
    })),
    branches: branches.map((b) => ({ name: b.name, latest: latestPerRuntime(b) })),
  };
};

/** The production channels that serve a branch: the ones whose publishes reach real users. */
export const productionChannelsServing = (branchId: string, channels: readonly RawChannel[], production: readonly string[]): readonly string[] =>
  channels.filter((c) => isProductionChannel(c.name, production) && branchIdsOf(c).includes(branchId)).map((c) => c.name);

/** What publishUpdateGroups takes to put an existing group on a branch again: no upload, the same manifests. */
export type RepublishInput = {
  readonly branchId: string;
  readonly runtimeVersion: string;
  readonly message: string;
  readonly updateInfoGroup?: Readonly<Record<string, unknown>>;
  readonly rollBackToEmbeddedInfoGroup?: Readonly<Record<string, boolean>>;
  readonly fingerprintInfoGroup?: Readonly<Record<string, unknown>>;
  readonly gitCommitHash: string | null;
  readonly isGitWorkingTreeDirty: boolean;
  readonly environment: string | null;
  readonly awaitingCodeSigningInfo: false;
  readonly manifestHostOverride: string | null;
  readonly assetHostOverride: string | null;
  /** Per platform, the rollout update this publish ends (a revert): EAS refuses a publish over a rollout in progress without it. */
  readonly previousRolloutUpdateToClobberIdGroup?: Readonly<Record<string, string>>;
};

/**
 * An update group republished onto a branch, as `eas update:republish` does it
 * (a rollback to an earlier group, or a promotion from preview to
 * production), or why it cannot be. Two cases are refused rather than
 * half-done: a signed group (a republish must be signed again with the
 * private key, which this server does not hold) and a group in a rollout
 * (finish the rollout first).
 */
export const republishPlan = (
  group: readonly RawGroupUpdate[],
  target: { readonly id: string; readonly name: string },
  options: { readonly platform?: "ios" | "android"; readonly message?: string },
): { readonly input: RepublishInput; readonly platforms: readonly string[]; readonly runtimeVersion: string } | { readonly problem: string } => {
  const updates = options.platform === undefined ? group : group.filter((u) => u.platform === options.platform);
  const [first] = updates;
  if (first === undefined) return { problem: options.platform === undefined ? "no such update group" : `the group has no ${options.platform} update` };
  if (updates.some((u) => u.codeSigningInfo !== null)) return { problem: "the group is code-signed; republish it with eas update:republish --private-key-path, which holds the key" };
  if (updates.some((u) => u.rolloutControlUpdate !== null)) return { problem: "the group is in a rollout; finish or revert the rollout before republishing it" };
  if (updates.some((u) => u.runtime.version !== first.runtime.version)) return { problem: "the group's updates are on different runtimes; republish one platform at a time" };
  const rollBack = first.isRollBackToEmbedded;
  if (updates.some((u) => u.isRollBackToEmbedded !== rollBack)) return { problem: "the group mixes roll-backs to the embedded update with updates; republish one platform at a time" };
  const byPlatform = <T>(f: (u: RawGroupUpdate) => T | undefined): Readonly<Record<string, T>> =>
    Object.fromEntries(updates.flatMap((u) => {
      const v = f(u);
      return v === undefined ? [] : [[u.platform, v] as const];
    }));
  const fingerprints = byPlatform((u) =>
    u.fingerprint === null
      ? undefined
      : { fingerprintHash: u.fingerprint.hash, fingerprintSource: u.fingerprint.source === null ? {} : { ...u.fingerprint.source } },
  );
  const input: RepublishInput = {
    branchId: target.id,
    runtimeVersion: first.runtime.version,
    message: options.message ?? `Republish of group ${first.group}${first.message ? `: ${first.message.split("\n")[0]}` : ""}`,
    ...(rollBack
      ? { rollBackToEmbeddedInfoGroup: byPlatform(() => true) }
      : { updateInfoGroup: byPlatform((u) => JSON.parse(u.manifestFragment) as unknown) }),
    ...(rollBack || Object.keys(fingerprints).length === 0 ? {} : { fingerprintInfoGroup: fingerprints }),
    gitCommitHash: first.gitCommitHash,
    isGitWorkingTreeDirty: first.isGitWorkingTreeDirty,
    environment: first.environment,
    awaitingCodeSigningInfo: false,
    manifestHostOverride: first.manifestHostOverride,
    assetHostOverride: first.assetHostOverride,
  };
  return { input, platforms: updates.map((u) => u.platform), runtimeVersion: first.runtime.version };
};
