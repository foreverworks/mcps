import { compact } from "@foreverworks/mcp-kit";

import type { Deps } from "../ports.js";
import { resolveProject } from "./projects.js";

/**
 * A project's fingerprints (the hash of its native side), newest first, each
 * with how many builds and updates carry it and the latest few of each: the
 * question behind a fingerprint-gated workflow ("is there a build for this
 * native state yet?").
 */
export const listFingerprints = async (deps: Deps, args: { readonly project?: string; readonly hash?: string; readonly limit: number }) => {
  const app = await resolveProject(deps, args.project);
  const fingerprints = await deps.eas.fingerprints(app.id, { first: args.limit, ...compact({ hashes: args.hash === undefined ? undefined : [args.hash] }) });
  return { project: app.fullName, fingerprints };
};
