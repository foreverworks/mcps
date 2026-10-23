import { compact } from "@foreverworks/mcp-kit";

import { toPlatform } from "../../domain/projects.js";
import type { RawBuild } from "../../domain/schema.js";
import { buildSummaryView, buildView } from "../../domain/views.js";
import type { Deps } from "../ports.js";
import { failedStepOf, readSteps, stepsTable } from "./logs.js";
import { resolveProject } from "./projects.js";

export type BuildsQuery = {
  readonly project?: string;
  readonly platform?: "ios" | "android";
  readonly status?: string;
  readonly profile?: string;
  readonly appIdentifier?: string;
  readonly commit?: string;
  readonly fingerprint?: string;
  readonly limit: number;
  readonly offset: number;
};

export const listBuilds = async (deps: Deps, q: BuildsQuery) => {
  const app = await resolveProject(deps, q.project);
  const builds = await deps.eas.builds(app.id, {
    offset: q.offset,
    limit: q.limit,
    ...compact({
      platform: q.platform === undefined ? undefined : toPlatform(q.platform),
      status: q.status,
      profile: q.profile,
      appIdentifier: q.appIdentifier,
      gitCommitHash: q.commit,
      fingerprintHash: q.fingerprint,
    }),
  });
  return { project: app.fullName, builds: builds.map(buildSummaryView), ...(builds.length === q.limit ? { nextOffset: q.offset + q.limit } : {}) };
};

/**
 * One build, with its artifacts, fingerprint and runtime; for a build that
 * errored, the step that failed and why, from its log; and every step when asked.
 */
export const getBuild = async (deps: Deps, args: { readonly build: string; readonly steps: boolean; readonly lines: number }) =>
  buildAnswer(deps, await deps.eas.build(args.build), args);

/** What get_build answers for a build already read. */
export const buildAnswer = async (deps: Deps, build: RawBuild, args: { readonly steps: boolean; readonly lines: number }) => {
  const view = buildView(build);
  if (build.status !== "ERRORED" && !args.steps) return view;
  const steps = await readSteps(deps, build.logFiles);
  const failed = failedStepOf(steps, args.lines);
  return {
    ...view,
    ...(failed === undefined ? {} : { failedStep: failed }),
    ...(args.steps ? { steps: steps === undefined ? null : stepsTable(steps, args.lines) } : {}),
  };
};

/** Cancel a queued or running build; EAS refuses one that has already ended, and says so. */
export const cancelBuild = async (deps: Deps, args: { readonly build: string }) => {
  const build = await deps.eas.cancelBuild(args.build);
  return { build: buildSummaryView(build) };
};
