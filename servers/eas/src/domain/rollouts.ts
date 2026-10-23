import type { RawGroupUpdate } from "./schema.js";
import { type RepublishInput, republishPlan } from "./updates.js";

/**
 * EAS Update rollouts, one group at a time. A rollout update reaches its
 * percentage of the devices on its branch and runtime; the rest get its
 * control update, the latest before it. EAS's own rules, read from eas-cli 25.3
 * (update:edit, update:revert-update-rollout, update/active-rollout.js) and
 * docs.expo.dev/eas-update/rollouts (2026-10-22):
 *
 * - a rollout only grows: eas update:edit refuses a percentage below the
 *   current one; 100 rolls it out fully;
 * - reverting republishes the control update, and a publish over a rollout in
 *   progress must name the rollout update it ends
 *   (`previousRolloutUpdateToClobberIdGroup`), or EAS refuses it;
 * - a rollout with no control update (the branch's first update on its runtime)
 *   reverts to the update embedded in the app, which needs the app's expo-updates
 *   version checked in its project: refused here, with where to do it.
 *
 * eas-cli's revert deletes the rollout group before it republishes; this one
 * ends it the way a publish over a rollout does and leaves it in the branch's
 * history, so nothing is deleted.
 */

export type Platform = "ios" | "android";

const ofPlatform = (group: readonly RawGroupUpdate[], platform: Platform | undefined) =>
  platform === undefined ? group : group.filter((u) => u.platform === platform);

const label = (group: readonly RawGroupUpdate[]): string => group[0]?.group ?? "(unknown)";

/** The group's updates that are in a rollout, at their one shared percentage; or why they are not one rollout. */
const rolloutIn = (group: readonly RawGroupUpdate[], platform: Platform | undefined): { readonly updates: readonly RawGroupUpdate[]; readonly at: number } | { readonly problem: string } | { readonly none: true } => {
  const updates = ofPlatform(group, platform);
  if (updates.length === 0) return { problem: platform === undefined ? "no such update group" : `update group ${label(group)} has no ${platform} update` };
  const rolling = updates.filter((u) => u.rolloutPercentage !== null);
  if (rolling.length === 0) return { none: true };
  const percentages = [...new Set(rolling.map((u) => u.rolloutPercentage))];
  if (percentages.length > 1) {
    const each = rolling.map((u) => `${u.platform} ${u.rolloutPercentage}%`).join(", ");
    return { problem: `update group ${label(group)} rolls out at different percentages per platform (${each}); name one platform` };
  }
  return { updates: rolling, at: percentages[0] as number };
};

/**
 * What setting a group's rollout to `percentage` changes. Setting what it
 * already is changes nothing, and so does 100 on a group in no rollout (it is
 * fully out already), which is what makes repeating the call safe.
 */
export const rolloutChange = (
  group: readonly RawGroupUpdate[],
  percentage: number,
  platform: Platform | undefined,
): { readonly change: readonly RawGroupUpdate[]; readonly from: number } | { readonly unchanged: true; readonly at: number | null; readonly updates: readonly RawGroupUpdate[] } | { readonly problem: string } => {
  const found = rolloutIn(group, platform);
  if ("problem" in found) return found;
  if ("none" in found) {
    return percentage === 100
      ? { unchanged: true, at: null, updates: ofPlatform(group, platform) }
      : { problem: `update group ${label(group)} is not in a rollout (or its rollout has ended); a rollout starts with eas update --rollout-percentage` };
  }
  if (percentage === found.at) return { unchanged: true, at: found.at, updates: found.updates };
  if (percentage < found.at) {
    return { problem: `update group ${label(group)} rolls out to ${found.at}%, and a rollout only grows; to take it back, revert_rollout returns its devices to the update before it` };
  }
  return { change: found.updates, from: found.at };
};

/** One platform of a rollout being reverted: the rollout update and the control update its devices go back to. */
export type RevertedUpdate = { readonly platform: string; readonly rollout: RawGroupUpdate; readonly control: { readonly id: string; readonly group: string } };

/** The updates a revert ends, each with its control; or why the group cannot be reverted. */
export const revertTargets = (group: readonly RawGroupUpdate[], platform: Platform | undefined): readonly RevertedUpdate[] | { readonly problem: string } => {
  const found = rolloutIn(group, platform);
  if ("problem" in found) return found;
  if ("none" in found) return { problem: `update group ${label(group)} is not in a rollout (or its rollout has ended); nothing to revert` };
  const targets: RevertedUpdate[] = [];
  for (const u of found.updates) {
    if (u.rolloutControlUpdate === null) {
      return {
        problem:
          `the ${u.platform} rollout of group ${u.group} has no update before it on ${u.branch.name} for runtime ${u.runtime.version}, so a revert means ` +
          "rolling back to the update embedded in the app; do that with eas update:revert-update-rollout in the project, which checks the app supports it",
      };
    }
    targets.push({ platform: u.platform, rollout: u, control: u.rolloutControlUpdate });
  }
  return targets;
};

/**
 * The publishes that revert a rollout: each control group put on the
 * rollout's branch again, for the platforms whose control it holds, ending
 * that platform's rollout update. Refused as a republish would be: a control
 * group that is code-signed, or itself in a rollout.
 */
export const revertInputs = (
  targets: readonly RevertedUpdate[],
  controls: ReadonlyMap<string, readonly RawGroupUpdate[]>,
): readonly { readonly from: string; readonly platforms: readonly string[]; readonly input: RepublishInput }[] | { readonly problem: string } => {
  const branch = targets[0]?.rollout.branch;
  const rolloutGroup = targets[0]?.rollout.group;
  if (branch === undefined || rolloutGroup === undefined) return { problem: "nothing to revert" };
  const byControl = new Map<string, RevertedUpdate[]>();
  for (const t of targets) byControl.set(t.control.group, [...(byControl.get(t.control.group) ?? []), t]);
  const inputs = [];
  for (const [controlGroup, mine] of byControl) {
    const ids = new Set(mine.map((t) => t.control.id));
    const updates = (controls.get(controlGroup) ?? []).filter((u) => ids.has(u.id));
    if (updates.length !== mine.length) return { problem: `the control update group ${controlGroup} no longer has every update the rollout went back to; nothing was changed` };
    const first = updates[0] as RawGroupUpdate;
    const plan = republishPlan(updates, branch, { message: `Revert of rollout ${rolloutGroup}: back to group ${controlGroup}${first.message ? `: ${first.message.split("\n")[0]}` : ""}` });
    if ("problem" in plan) return { problem: `the control update group ${controlGroup} cannot be put back: ${plan.problem}` };
    const clobber = Object.fromEntries(mine.map((t) => [t.platform, t.rollout.id]));
    inputs.push({ from: controlGroup, platforms: plan.platforms, input: { ...plan.input, previousRolloutUpdateToClobberIdGroup: clobber } });
  }
  return inputs;
};
