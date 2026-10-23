import { compact } from "@foreverworks/mcp-kit";

import { fail, inputError } from "../../domain/errors.js";
import { buildIdentity, buildMismatch } from "../../domain/identity.js";
import { toPlatform } from "../../domain/projects.js";
import { submissionLogUrls, submissionView } from "../../domain/views.js";
import type { Deps } from "../ports.js";
import { failedStepOf, readSteps, stepsTable } from "./logs.js";
import { resolveProject } from "./projects.js";

export const listSubmissions = async (
  deps: Deps,
  q: { readonly project?: string; readonly platform?: "ios" | "android"; readonly status?: string; readonly limit: number; readonly offset: number },
) => {
  const app = await resolveProject(deps, q.project);
  const submissions = await deps.eas.submissions(app.id, {
    offset: q.offset,
    limit: q.limit,
    ...compact({ platform: q.platform === undefined ? undefined : toPlatform(q.platform), status: q.status }),
  });
  return {
    project: app.fullName,
    submissions: submissions.map(submissionView),
    ...(submissions.length === q.limit ? { nextOffset: q.offset + q.limit } : {}),
  };
};

/**
 * One submission with Apple's (or Google's) error text, and for one that
 * errored, the failed step of its log: its own log, or that of the workflow
 * job that made it.
 */
export const getSubmission = async (deps: Deps, args: { readonly submission: string; readonly steps: boolean; readonly lines: number }) => {
  const submission = await deps.eas.submission(args.submission);
  const view = submissionView(submission);
  if (submission.status !== "ERRORED" && !args.steps) return view;
  const steps = await readSteps(deps, submissionLogUrls(submission));
  const failed = failedStepOf(steps, args.lines);
  return {
    ...view,
    ...(failed === undefined ? {} : { failedStep: failed }),
    ...(args.steps ? { steps: steps === undefined ? null : stepsTable(steps, args.lines) } : {}),
  };
};

export type SubmitArgs = {
  readonly build: string;
  readonly asc_app_id?: string;
  readonly what_to_test?: string;
  readonly groups?: readonly string[];
  readonly track?: string;
  readonly release_status?: "draft" | "in_progress" | "halted" | "completed";
  readonly rollout?: number;
  /** The app version the build must have; a mismatch submits nothing. */
  readonly expect_version?: string;
  /** The build number (CFBundleVersion, versionCode) the build must have. */
  readonly expect_build_number?: string;
};

/**
 * Submit a build that already exists: to App Store Connect (TestFlight) for
 * iOS, to a Google Play track for Android. Everything else comes from what EAS
 * holds for the build's own bundle id or package: the App Store Connect key or
 * the Google service account set for submissions (the audit's `submitKey`),
 * and, for iOS, the App Store Connect app, which Apple names through that key.
 * So the submission uses exactly what a workflow's submit job would, and a
 * missing piece fails here, before anything is scheduled.
 *
 * A build id is long and opaque, and a wrongly copied one ships another build:
 * the answer names the build's version, build number, platform and commit, and
 * an expected version or build number that differs refuses the call first.
 */
export const submitBuild = async (deps: Deps, args: SubmitArgs) => {
  const build = await deps.eas.build(args.build);
  const mismatch = buildMismatch(build, compact({ version: args.expect_version, buildNumber: args.expect_build_number }));
  if (mismatch !== undefined) return fail(inputError(mismatch));
  if (build.status !== "FINISHED") return fail(inputError(`build ${build.id} is ${build.status}; only a FINISHED build can be submitted`));
  const identifier = build.appIdentifier ?? fail(inputError(`build ${build.id} names no bundle id or package`));
  const appId = build.app.id;
  const credentials = await deps.eas.credentials(appId);
  if (build.platform === "IOS") {
    if (build.isForIosSimulator) return fail(inputError(`build ${build.id} is a simulator build; App Store Connect takes device builds only`));
    const ios = credentials.ios.find((c) => c.appleAppIdentifier.bundleIdentifier === identifier);
    const key = ios?.appStoreConnectApiKeyForSubmissions;
    if (ios === undefined || key === null || key === undefined) {
      return fail(inputError(`${identifier} has no App Store Connect API key for submissions on EAS; set one with set_submit_key first`));
    }
    const ascAppIdentifier =
      args.asc_app_id ??
      (await deps.eas.ascAppIdFor(key.id, identifier)) ??
      fail(inputError(`App Store Connect has no app for ${identifier} that key ${key.keyIdentifier} can see; pass asc_app_id`));
    const submission = await deps.eas.submitIos(appId, build.id, {
      ascAppIdentifier,
      ascApiKeyId: key.id,
      ...compact({ changelog: args.what_to_test, groups: args.groups }),
    });
    return {
      project: build.app.fullName,
      build: buildIdentity(build),
      submission: submissionView(submission),
      note: "follow it with get_submission; Apple's processing takes a few minutes more",
    };
  }
  const android = credentials.android.find((c) => c.applicationIdentifier === identifier);
  const serviceAccount = android?.googleServiceAccountKeyForSubmissions;
  if (serviceAccount === null || serviceAccount === undefined) {
    return fail(inputError(`${identifier} has no Google service account key for submissions on EAS (eas credentials, Android)`));
  }
  const submission = await deps.eas.submitAndroid(appId, build.id, {
    serviceAccountKeyId: serviceAccount.id,
    applicationIdentifier: identifier,
    track: args.track ?? "internal",
    ...compact({ releaseStatus: args.release_status?.toUpperCase(), rollout: args.rollout, changelog: args.what_to_test }),
  });
  return { project: build.app.fullName, build: buildIdentity(build), submission: submissionView(submission), note: "follow it with get_submission" };
};
