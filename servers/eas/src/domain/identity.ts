import type { RawBuild, RawGroupUpdate } from "./schema.js";

/**
 * What a build or an update group IS, as the writes that act on one echo it:
 * the version, the build number, the commit. An id is long and opaque, so a
 * wrongly copied one would otherwise ship another build without anything
 * looking wrong. A caller that knows what it means to ship says so
 * (`expect_version`, `expect_build_number`, `expect_commit`), and a mismatch
 * refuses the call before anything is sent. Pure.
 */

const firstLine = (text: string | null): string | null => (text === null ? null : (text.split("\n")[0] ?? ""));

/** A commit as a caller names it: a hex prefix of at least 7 characters, as `git log --oneline` prints it. */
export const COMMIT_PREFIX = /^[0-9a-fA-F]{7,40}$/;

const sameCommit = (actual: string | null, expected: string): boolean => actual !== null && actual.toLowerCase().startsWith(expected.toLowerCase());

export const buildIdentity = (b: RawBuild) => ({
  id: b.id,
  platform: b.platform,
  profile: b.buildProfile,
  appIdentifier: b.appIdentifier,
  appVersion: b.appVersion,
  buildNumber: b.appBuildVersion,
  commit: b.gitCommitHash,
  commitMessage: firstLine(b.gitCommitMessage),
  completedAt: b.completedAt,
});

export type BuildExpectation = { readonly version?: string; readonly buildNumber?: string };

/** Why this build is not the one the caller expected, or undefined when it is (or nothing was expected). */
export const buildMismatch = (b: RawBuild, expected: BuildExpectation): string | undefined => {
  const wrong = [
    expected.version !== undefined && b.appVersion !== expected.version ? `app version ${b.appVersion ?? "(none)"}, not ${expected.version}` : undefined,
    expected.buildNumber !== undefined && b.appBuildVersion !== expected.buildNumber
      ? `build number ${b.appBuildVersion ?? "(none)"}, not ${expected.buildNumber}`
      : undefined,
  ].filter((w): w is string => w !== undefined);
  if (wrong.length === 0) return undefined;
  const what = [b.platform, b.buildProfile, b.gitCommitHash === null ? undefined : `commit ${b.gitCommitHash.slice(0, 12)}`].filter((w) => w !== null && w !== undefined);
  return `build ${b.id} (${what.join(", ")}) has ${wrong.join(" and ")}; nothing was submitted (check the build id with list_builds)`;
};

/** Where an update group came from: its project, branch, commit and message, as a republish echoes it. */
export const groupSource = (updates: readonly RawGroupUpdate[]) => {
  const [first] = updates;
  if (first === undefined) return undefined;
  return {
    group: first.group,
    project: first.app.fullName,
    branch: first.branch.name,
    platforms: updates.map((u) => u.platform),
    commit: first.gitCommitHash,
    message: firstLine(first.message),
    createdAt: first.createdAt,
  };
};

/**
 * Why this group may not be republished onto `project`, or undefined: it
 * belongs to another project, or it was not published from the commit the
 * caller expected.
 */
export const groupMismatch = (
  updates: readonly RawGroupUpdate[],
  project: { readonly id: string; readonly fullName: string },
  expectedCommit: string | undefined,
  outcome = "nothing was republished",
): string | undefined => {
  const [first] = updates;
  if (first === undefined) return undefined;
  const elsewhere = updates.find((u) => u.app.id !== project.id);
  if (elsewhere !== undefined) {
    return `update group ${first.group} belongs to ${elsewhere.app.fullName}, not ${project.fullName}; ${outcome} (list_updates gives this project's groups)`;
  }
  if (expectedCommit !== undefined && !updates.every((u) => sameCommit(u.gitCommitHash, expectedCommit))) {
    return `update group ${first.group} was published from commit ${first.gitCommitHash ?? "(none recorded)"}, not ${expectedCommit}; ${outcome}`;
  }
  return undefined;
};
