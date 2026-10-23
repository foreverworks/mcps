import { compact, type OutputOf } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { listFingerprints } from "../../app/usecases/fingerprints.js";
import { revertRollout, setRollout } from "../../app/usecases/rollouts.js";
import { listUpdates, republishUpdate } from "../../app/usecases/updates.js";
import { COMMIT_PREFIX } from "../../domain/identity.js";
import { type ArgsOf, limit, platform, project } from "../args.js";
import { handled } from "../envelope.js";
import { FINGERPRINTS_OUTPUT, UPDATES_OUTPUT } from "../outputs.js";
import type { Registrar } from "./types.js";

const FINGERPRINTS = {
  project,
  hash: z.string().trim().min(1).optional().describe("One fingerprint hash (a build's or a fingerprint job's output)."),
  limit: limit(10, 50),
};

const UPDATES = { project };

export const REPUBLISH = {
  project,
  group: z.string().trim().min(1).describe("The update group to put on the branch again (list_updates gives groups)."),
  branch: z.string().trim().min(1).describe('The update branch to republish onto, e.g. "production".'),
  platform: platform.describe("Only this platform's update of the group. Default: every platform in it."),
  message: z.string().trim().min(1).max(1000).optional().describe("The new update's message. Default: names the group republished."),
  expect_commit: z
    .string()
    .trim()
    .regex(COMMIT_PREFIX, "a commit hash or a prefix of at least 7 hex characters")
    .optional()
    .describe("The commit the group must have been published from (a hash, or a prefix of at least 7 characters). Checked before anything is published."),
};

const rolloutGroup = z.string().trim().min(1).describe("The update group in the rollout (list_updates shows each branch's latest groups with their rolloutPercentage).");

const SET_ROLLOUT = {
  project,
  group: rolloutGroup,
  percentage: z.number().int().min(1).max(100).describe("The share of devices to get it, higher than now; 100 rolls it out to every device."),
  platform: platform.describe("Only this platform's update of the group. Default: every platform in the rollout."),
};

const REVERT_ROLLOUT = {
  project,
  group: rolloutGroup,
  platform: platform.describe("Only this platform's rollout. Default: every platform in it."),
};

export const registerUpdates: Registrar = (server, deps) => {
  server.registerTool(
    "list_fingerprints",
    {
      title: "List fingerprints",
      description:
        "A project's fingerprints (the hash of its native side), newest first, or one by hash: how many builds and updates carry " +
        "each, and the latest of them. Answers whether a build exists for a native state, the question a fingerprint-gated workflow asks.",
      inputSchema: FINGERPRINTS,
      outputSchema: FINGERPRINTS_OUTPUT,
    },
    handled((a: ArgsOf<typeof FINGERPRINTS>): Promise<OutputOf<typeof FINGERPRINTS_OUTPUT>> => listFingerprints(deps, { limit: a.limit, ...compact({ project: a.project, hash: a.hash }) })),
  );

  server.registerTool(
    "list_updates",
    {
      title: "List updates",
      description:
        "A project's EAS Update channels with the branches they serve (production ones marked), and per branch the latest update for " +
        "each platform and runtime version: what a device on that runtime downloads next.",
      inputSchema: UPDATES,
      outputSchema: UPDATES_OUTPUT,
    },
    handled((a: ArgsOf<typeof UPDATES>): Promise<OutputOf<typeof UPDATES_OUTPUT>> => listUpdates(deps, compact(a))),
  );

  server.registerTool(
    "set_rollout",
    {
      title: "Set rollout",
      description:
        "Raise an update group's rollout to a percentage of the devices on its branch and runtime, as eas update:edit does; 100 rolls " +
        "it out to every device and ends the rollout. A rollout only grows (revert_rollout takes it back); setting what it already is " +
        "changes nothing. Answers with the percentage before and after, and the production channels that serve the branch.",
      inputSchema: SET_ROLLOUT,
    },
    handled((a: ArgsOf<typeof SET_ROLLOUT>) => setRollout(deps, { group: a.group, percentage: a.percentage, ...compact({ project: a.project, platform: a.platform }) })),
  );

  server.registerTool(
    "revert_rollout",
    {
      title: "Revert rollout",
      description:
        "End an update group's rollout by sending every device on its branch and runtime back to the update before it, as eas " +
        "update:revert-update-rollout does: that update's group is published on the branch again, ending the rollout; nothing is " +
        "deleted or uploaded. Refuses a rollout something newer already ended, and one with no update before it (the app's embedded " +
        "update; revert that with eas-cli in the project). Answers with the groups republished and the production channels.",
      inputSchema: REVERT_ROLLOUT,
    },
    handled((a: ArgsOf<typeof REVERT_ROLLOUT>) => revertRollout(deps, { group: a.group, ...compact({ project: a.project, platform: a.platform }) })),
  );

  server.registerTool(
    "republish_update",
    {
      title: "Republish update",
      description:
        "Put an existing update group on a branch again, as eas update:republish does: roll a branch back to an earlier group, or " +
        "promote a group from one branch to another. Nothing is uploaded. Refuses a group of another project, a code-signed group " +
        "or one in a rollout, and with expect_commit a group published from another commit. Answers with where the group came " +
        "from (its branch, commit and message) and the new group.",
      inputSchema: REPUBLISH,
    },
    handled((a: ArgsOf<typeof REPUBLISH>) =>
      republishUpdate(deps, { group: a.group, branch: a.branch, ...compact({ project: a.project, platform: a.platform, message: a.message, expectCommit: a.expect_commit }) }),
    ),
  );
};
