import { compact, type OutputOf } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { getSubmission, listSubmissions, submitBuild } from "../../app/usecases/submissions.js";
import { type ArgsOf, id, limit, lines, offset, platform, project, steps } from "../args.js";
import { handled } from "../envelope.js";
import { SUBMISSIONS_OUTPUT } from "../outputs.js";
import type { Registrar } from "./types.js";

const SUBMISSION_STATUS = ["AWAITING_BUILD", "IN_QUEUE", "IN_PROGRESS", "FINISHED", "ERRORED", "CANCELED"] as const;

const LIST = { project, platform, status: z.enum(SUBMISSION_STATUS).optional(), limit: limit(10, 50), offset };

const GET = { submission: id("The submission id."), steps, lines: lines(0) };

const SUBMIT = {
  build: id("The id of a FINISHED build (list_builds)."),
  asc_app_id: z
    .string()
    .trim()
    .regex(/^\d+$/)
    .optional()
    .describe("iOS: the App Store Connect app id. Default: the app App Store Connect has for the build's bundle id, asked through its key."),
  what_to_test: z.string().trim().min(1).max(4000).optional().describe("iOS: TestFlight's What to Test; Android: the release notes."),
  groups: z.array(z.string().trim().min(1)).optional().describe("iOS: TestFlight groups to add the build to."),
  track: z.string().trim().min(1).optional().describe('Android: the Google Play track. Default "internal".'),
  release_status: z.enum(["draft", "in_progress", "halted", "completed"]).optional().describe("Android: the release status on the track."),
  rollout: z.number().gt(0).max(1).optional().describe("Android: the staged rollout fraction, with release_status in_progress."),
  expect_version: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('The app version the build must have, e.g. "1.4.2". Checked before anything is submitted, so a wrongly copied build id fails instead of shipping another build.'),
  expect_build_number: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('The build number the build must have (iOS CFBundleVersion, Android versionCode), e.g. "42". Checked the same way.'),
};

export const registerSubmissions: Registrar = (server, deps) => {
  server.registerTool(
    "list_submissions",
    {
      title: "List submissions",
      description:
        "A project's App Store Connect and Google Play submissions, newest first: status, the build (identifier, version, build " +
        "number), the ASC app or Play track, the workflow job that made it, and error: Apple's or Google's own text (for a workflow's " +
        "submission it lives on the job, which this reads).",
      inputSchema: LIST,
      outputSchema: SUBMISSIONS_OUTPUT,
    },
    handled((a: ArgsOf<typeof LIST>): Promise<OutputOf<typeof SUBMISSIONS_OUTPUT>> => listSubmissions(deps, { limit: a.limit, offset: a.offset, ...compact({ project: a.project, platform: a.platform, status: a.status }) })),
  );

  server.registerTool(
    "get_submission",
    {
      title: "Get submission",
      description:
        "One submission with Apple's or Google's error text; one that ERRORED also carries failedStep from its log (its own, or the " +
        "workflow job's that made it); steps lists every step.",
      inputSchema: GET,
    },
    handled((a: ArgsOf<typeof GET>) => getSubmission(deps, a)),
  );

  server.registerTool(
    "submit_build",
    {
      title: "Submit build",
      description:
        "Submit an existing FINISHED build: iOS to App Store Connect (TestFlight), Android to a Google Play track. It uses what EAS " +
        "holds for the build's own bundle id or package (the ASC key or Google service account set for submissions, as " +
        "audit_credentials shows it), so it fails before scheduling anything when that is missing. Spends no build credits. Give " +
        "expect_version or expect_build_number when you know what should ship: a build that differs is refused. Answers with the " +
        "build as submitted (platform, profile, app version, build number, commit) and the submission; follow it with get_submission.",
      inputSchema: SUBMIT,
    },
    handled((a: ArgsOf<typeof SUBMIT>) => submitBuild(deps, compact(a))),
  );
};
