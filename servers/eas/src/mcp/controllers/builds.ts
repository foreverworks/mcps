import { compact, type OutputOf } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { cancelBuild, getBuild, listBuilds } from "../../app/usecases/builds.js";
import { type ArgsOf, id, limit, lines, offset, platform, project, steps } from "../args.js";
import { handled } from "../envelope.js";
import { BUILDS_OUTPUT } from "../outputs.js";
import type { Registrar } from "./types.js";

const BUILD_STATUS = ["NEW", "IN_QUEUE", "IN_PROGRESS", "PENDING_CANCEL", "ERRORED", "FINISHED", "CANCELED"] as const;

const LIST = {
  project,
  platform,
  status: z.enum(BUILD_STATUS).optional(),
  profile: z.string().trim().min(1).optional().describe('The eas.json build profile, e.g. "production".'),
  app_identifier: z.string().trim().min(1).optional().describe("A bundle id or package, e.g. com.example.app.dev."),
  commit: z.string().trim().regex(/^[0-9a-f]{40}$/).optional().describe("The full git commit hash the build was made from."),
  fingerprint: z.string().trim().min(1).optional().describe("Builds carrying this fingerprint hash."),
  limit: limit(20, 50),
  offset,
};

const GET = { build: id("The build id."), steps, lines: lines(0) };
const CANCEL = { build: id("The build id.") };

export const registerBuilds: Registrar = (server, deps) => {
  server.registerTool(
    "list_builds",
    {
      title: "List builds",
      description:
        "A project's builds, newest first, filtered by platform, status, profile, bundle id or package, commit or fingerprint. Each " +
        "says its status, profile, identifier, version and build number, commit, fingerprint, runtime, who started it and its error.",
      inputSchema: LIST,
      outputSchema: BUILDS_OUTPUT,
    },
    handled((a: ArgsOf<typeof LIST>): Promise<OutputOf<typeof BUILDS_OUTPUT>> =>
      listBuilds(deps, {
        limit: a.limit,
        offset: a.offset,
        ...compact({
          project: a.project,
          platform: a.platform,
          status: a.status,
          profile: a.profile,
          appIdentifier: a.app_identifier,
          commit: a.commit,
          fingerprint: a.fingerprint,
        }),
      }),
    ),
  );

  server.registerTool(
    "get_build",
    {
      title: "Get build",
      description:
        "One build: its artifacts (the .ipa/.aab URL), fingerprint, runtime version, channel, timings and error. A build that " +
        "ERRORED also carries failedStep, the step that failed and the line that says why, read from its log; steps lists them all.",
      inputSchema: GET,
    },
    handled((a: ArgsOf<typeof GET>) => getBuild(deps, a)),
  );

  server.registerTool(
    "cancel_build",
    {
      title: "Cancel build",
      description: "Cancel a build that is queued or running. EAS refuses one that has already ended, and says so; nothing else changes.",
      inputSchema: CANCEL,
    },
    handled((a: ArgsOf<typeof CANCEL>) => cancelBuild(deps, a)),
  );
};
