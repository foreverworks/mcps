import { failureLine, isFailed, type Step } from "./logs.js";
import type { RawWorkflowJob, RawWorkflowRun, WorkflowBuildJob } from "./schema.js";

/**
 * The rules about workflow runs that are not about the API: why a run failed,
 * in one line, and what a dispatch is about to spend, in the one line a user
 * confirms.
 */

/** What EAS says when it has nothing to say: the log has the reason, so the log is read instead. */
const GENERIC = /^Unknown error\. See logs/i;

const FAILED_JOB = new Set(["FAILURE"]);

export const isFailedJob = (job: RawWorkflowJob): boolean => FAILED_JOB.has(job.status);

export type JobFailure = {
  readonly job: string;
  readonly step?: string;
  readonly reason: string;
  readonly code?: string;
};

/**
 * Why one job failed, from the most specific source that says anything:
 * the job's own error (EAS's text, which for an upload is Apple's), then the
 * failed step of its log, then the build's error, then the generic message.
 */
export const jobFailure = (job: RawWorkflowJob, steps: readonly Step[] | undefined): JobFailure => {
  const own = job.turtleJobRun?.errors.find((e) => !GENERIC.test(e.message));
  if (own !== undefined) return { job: job.key, reason: own.message, code: own.errorCode };
  const jobError = job.errors.find((e) => !GENERIC.test(e.message));
  const failedStep = steps?.find(isFailed);
  if (failedStep !== undefined) return { job: job.key, step: failedStep.name, reason: failureLine(failedStep) };
  if (jobError !== undefined) return { job: job.key, reason: jobError.title ? `${jobError.title}: ${jobError.message}` : jobError.message };
  const build = job.turtleBuild?.error;
  if (build) return { job: job.key, reason: build.message, code: build.errorCode };
  const generic = job.turtleJobRun?.errors[0] ?? job.errors[0];
  return { job: job.key, reason: generic?.message ?? `the job ended ${job.status} and its log names no failed step` };
};

/** The failures as one line: "submit_ios > Prepare credentials: eas-cli failed to resolve submission config. ..." */
export const reasonLine = (run: RawWorkflowRun, failures: readonly JobFailure[]): string | undefined => {
  const parts = [
    ...run.errors.map((e) => (e.title ? `${e.title}: ${e.message}` : e.message)),
    ...failures.map((f) => `${f.job}${f.step === undefined ? "" : ` > ${f.step}`}: ${f.reason}`),
  ];
  return parts.length === 0 ? undefined : parts.join("; ");
};

/**
 * The line a user confirms for a dispatch: the project, the workflow file,
 * the ref, and the build jobs the file declares at that ref with their
 * platform and profile, because those are what spend EAS build credits. No
 * commit: EAS keys a workflow revision by the file's content and reports the
 * commit it FIRST saw that content at, which is not where the ref points now.
 * At most 300 characters (the kit cuts there).
 */
export const dispatchLine = (input: {
  readonly project: string;
  readonly fileName: string;
  readonly gitRef: string;
  readonly builds: readonly WorkflowBuildJob[];
}): string => {
  const head = `Run EAS workflow ${input.fileName} of ${input.project} at ${input.gitRef}`;
  if (input.builds.length === 0) return `${head}: it has no build job, so it spends no EAS build credits (other jobs may still submit or publish).`;
  const builds = input.builds.map((b) => `${b.platform} ${b.profile}${b.conditional ? " (if its condition holds)" : ""}`).join(", ");
  const spend = input.builds.every((b) => b.conditional) ? "may spend EAS build credits" : "spends EAS build credits";
  return `${head}: builds ${builds}; ${spend}.`;
};
