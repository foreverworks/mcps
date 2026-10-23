import { fail, inputError } from "../../domain/errors.js";
import { groupMismatch } from "../../domain/identity.js";
import { type Platform, revertInputs, revertTargets, rolloutChange } from "../../domain/rollouts.js";
import type { RawGroupUpdate } from "../../domain/schema.js";
import { productionChannelsServing } from "../../domain/updates.js";
import type { Deps } from "../ports.js";
import { resolveProject } from "./projects.js";

export type RolloutArgs = { readonly project?: string; readonly group: string; readonly platform?: Platform };

/** The group, checked to be this project's, and the production channels that serve its branch (whose devices are real users). */
const rolloutGroup = async (deps: Deps, args: RolloutArgs) => {
  const app = await resolveProject(deps, args.project);
  const group = await deps.eas.updateGroup(args.group.trim());
  if (group.length === 0) return fail(inputError(`no update group ${args.group.trim()} (list_updates gives each branch's latest groups)`));
  const mismatch = groupMismatch(group, app, undefined, "nothing was changed");
  if (mismatch !== undefined) return fail(inputError(mismatch));
  const branch = (group[0] as RawGroupUpdate).branch;
  const { channels } = await deps.eas.updates(app.id, 1);
  return { app, group, branch, production: productionChannelsServing(branch.id, channels, deps.productionChannels) };
};

/**
 * Raise a rollout's percentage, as eas update:edit does: every platform of the
 * group in the rollout (or the one named) moves to it together. 100 rolls it
 * out fully. Setting what it already is changes nothing, so a repeated call
 * is harmless; lowering it is refused (revert_rollout takes it back).
 */
export const setRollout = async (deps: Deps, args: RolloutArgs & { readonly percentage: number }) => {
  const { app, group, branch, production } = await rolloutGroup(deps, args);
  const plan = rolloutChange(group, args.percentage, args.platform);
  if ("problem" in plan) return fail(inputError(plan.problem));
  const head = { project: app.fullName, group: (group[0] as RawGroupUpdate).group, branch: branch.name, productionChannels: production };
  if ("unchanged" in plan) {
    return {
      ...head,
      changed: false,
      rolloutPercentage: plan.at,
      updates: plan.updates.map((u) => ({ id: u.id, platform: u.platform, rolloutPercentage: u.rolloutPercentage })),
      note: plan.at === null ? "not in a rollout: it is out to every device it is served to" : `already at ${plan.at}%; nothing was changed`,
    };
  }
  const updates = [];
  // One request per platform, as eas-cli does; EAS has no call that sets a group.
  for (const u of plan.change) updates.push(await deps.eas.setRollout(u.id, args.percentage));
  return {
    ...head,
    changed: true,
    previousPercentage: plan.from,
    rolloutPercentage: args.percentage,
    updates,
    note:
      args.percentage === 100
        ? `rolled out fully: every device on ${branch.name} at runtime ${(plan.change[0] as RawGroupUpdate).runtime.version} gets it at its next launch`
        : `${args.percentage}% of the devices on ${branch.name} at runtime ${(plan.change[0] as RawGroupUpdate).runtime.version} get it; the rest keep the update before it`,
  };
};

/**
 * End a rollout by sending every device back to the update before it, as eas
 * update:revert-update-rollout does: each platform's control update group is
 * published on the branch again, naming the rollout update it ends, so EAS
 * stops serving it. The rollout group stays in the branch's history, ended
 * (eas-cli deletes it), and nothing is deleted. Refused when the rollout is
 * no longer the latest on its branch for that platform and runtime: something
 * newer (an earlier revert, a later publish) already ended it.
 */
export const revertRollout = async (deps: Deps, args: RolloutArgs) => {
  const { app, group, branch, production } = await rolloutGroup(deps, args);
  const targets = revertTargets(group, args.platform);
  if ("problem" in targets) return fail(inputError(targets.problem));
  for (const t of targets) {
    const latest = await deps.eas.latestOnBranch(app.id, branch.name, t.platform, t.rollout.runtime.version);
    if (latest?.id !== t.rollout.id) {
      const by = latest === undefined ? "" : `: group ${latest.group} is the latest there now`;
      return fail(inputError(`the ${t.platform} rollout of group ${t.rollout.group} has already ended on ${branch.name} for runtime ${t.rollout.runtime.version}${by}; nothing was changed`));
    }
  }
  const controlGroups = [...new Set(targets.map((t) => t.control.group))];
  const controls = new Map(await Promise.all(controlGroups.map(async (g) => [g, await deps.eas.updateGroup(g)] as const)));
  const inputs = revertInputs(targets, controls);
  if ("problem" in inputs) return fail(inputError(inputs.problem));
  const published = await deps.eas.publishGroups(inputs.map((i) => i.input));
  const first = targets[0] as (typeof targets)[number];
  return {
    project: app.fullName,
    branch: branch.name,
    productionChannels: production,
    reverted: { group: first.rollout.group, rolloutPercentage: first.rollout.rolloutPercentage, platforms: targets.map((t) => t.platform) },
    republished: inputs.map((i) => ({ from: i.from, platforms: i.platforms })),
    updates: published.map((u) => ({ id: u.id, group: u.group, platform: u.platform })),
    note: `every device on ${branch.name} at runtime ${first.rollout.runtime.version} gets the update before the rollout at its next launch; the rollout's group stays in the branch's history, ended`,
  };
};
