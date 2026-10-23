import { fail, inputError, notFound } from "../../domain/errors.js";
import { groupMismatch, groupSource } from "../../domain/identity.js";
import { productionChannelsServing, republishPlan, updatesView } from "../../domain/updates.js";
import type { Deps } from "../ports.js";
import { resolveProject } from "./projects.js";

/** Updates read per branch: enough to find the latest for every platform and runtime still in use. */
const PER_BRANCH = 30;

/** Channels (and the branches they serve), and per branch the latest update for each platform and runtime. */
export const listUpdates = async (deps: Deps, args: { readonly project?: string }) => {
  const app = await resolveProject(deps, args.project);
  const { channels, branches } = await deps.eas.updates(app.id, PER_BRANCH);
  return { project: app.fullName, ...updatesView(channels, branches, deps.productionChannels) };
};

export type RepublishArgs = {
  readonly project?: string;
  readonly group: string;
  readonly branch: string;
  readonly platform?: "ios" | "android";
  readonly message?: string;
  /** A prefix of the commit the group must have been published from; a mismatch republishes nothing. */
  readonly expectCommit?: string;
};

/** Where a republish lands: the branch, and the production channels that serve it (empty: no real user gets it). */
export const republishTarget = async (deps: Deps, args: RepublishArgs) => {
  const app = await resolveProject(deps, args.project);
  const { channels, branches } = await deps.eas.updates(app.id, 1);
  const branch = branches.find((b) => b.name === args.branch.trim());
  if (branch === undefined) return fail(notFound(`${app.fullName} has no update branch "${args.branch}" (it has ${branches.map((b) => b.name).join(", ") || "none"})`));
  return { app, branch, production: productionChannelsServing(branch.id, channels, deps.productionChannels) };
};

/**
 * Put an existing update group on a branch again, as `eas update:republish`
 * does: a rollback to an earlier group, or a promotion from one branch to
 * another. Nothing is uploaded; the manifests are the group's own. A plain
 * write on every branch, production included; the answer names the production
 * channels that serve the branch, whose devices get it at their next launch,
 * and where the group came from (its branch, commit and message), so a wrongly
 * copied group id shows. A group of another project is refused, and so is one
 * not published from `expectCommit` when the caller names it.
 */
export const republishUpdate = async (deps: Deps, args: RepublishArgs) => {
  const target = await republishTarget(deps, args);
  const group = await deps.eas.updateGroup(args.group.trim());
  const mismatch = groupMismatch(group, target.app, args.expectCommit);
  if (mismatch !== undefined) return fail(inputError(mismatch));
  const plan = republishPlan(group, target.branch, { ...(args.platform === undefined ? {} : { platform: args.platform }), ...(args.message === undefined ? {} : { message: args.message }) });
  if ("problem" in plan) return fail(inputError(plan.problem));
  const published = await deps.eas.publishGroups([plan.input]);
  return {
    project: target.app.fullName,
    branch: target.branch.name,
    productionChannels: target.production,
    runtimeVersion: plan.runtimeVersion,
    source: groupSource(group),
    group: published[0]?.group ?? null,
    updates: published.map((u) => ({ id: u.id, platform: u.platform })),
  };
};
