import type { RawBuild, RawBuildSummary, RawSubmission, RawWorkflowJob, RawWorkflowRun } from "./schema.js";

/**
 * What a tool answers about each EAS object: the fields a reader acts on,
 * compact, with nulls kept where "none" is the answer (a build with no error,
 * a run with no commit) and left out where a field would always be empty.
 */

const firstLine = (text: string | null): string | null => (text === null ? null : (text.split("\n")[0] ?? ""));

export const buildSummaryView = (b: RawBuildSummary) => ({
  id: b.id,
  status: b.status,
  platform: b.platform,
  profile: b.buildProfile,
  appIdentifier: b.appIdentifier,
  appVersion: b.appVersion,
  buildNumber: b.appBuildVersion,
  distribution: b.distribution,
  gitCommitHash: b.gitCommitHash,
  fingerprint: b.fingerprint?.hash ?? null,
  runtimeVersion: b.runtime?.version ?? null,
  createdAt: b.createdAt,
  completedAt: b.completedAt,
  by: b.initiatingActor?.displayName ?? null,
  error: b.error === null ? null : `${b.error.errorCode}: ${b.error.message}`,
});

export const buildView = (b: RawBuild) => ({
  ...buildSummaryView(b),
  sdkVersion: b.sdkVersion,
  simulator: b.isForIosSimulator,
  gitCommitMessage: firstLine(b.gitCommitMessage),
  message: b.message,
  channel: b.updateChannel?.name ?? null,
  expiresAt: b.expirationDate,
  errorDocs: b.error?.docsUrl ?? null,
  artifacts: {
    application: b.artifacts?.applicationArchiveUrl ?? b.artifacts?.buildUrl ?? null,
    buildArtifacts: b.artifacts?.buildArtifactsUrl ?? null,
    xcodeLogs: b.artifacts?.xcodeBuildLogsUrl ?? null,
  },
  seconds: {
    queue: b.metrics?.buildQueueTime ?? null,
    wait: b.metrics?.buildWaitTime ?? null,
    build: b.metrics?.buildDuration ?? null,
  },
});

export const runView = (r: RawWorkflowRun) => ({
  id: r.id,
  workflow: r.workflow.fileName,
  status: r.status,
  gitRef: r.requestedGitRef,
  gitCommitHash: r.gitCommitHash,
  gitCommitMessage: firstLine(r.gitCommitMessage),
  trigger: r.triggerEventType,
  ...(r.triggeringSchedule === null ? {} : { schedule: r.triggeringSchedule }),
  by: r.actor?.displayName ?? null,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  ...(r.errors.length === 0 ? {} : { errors: r.errors.map((e) => (e.title ? `${e.title}: ${e.message}` : e.message)) }),
});

export const jobView = (j: RawWorkflowJob) => ({
  id: j.id,
  key: j.key,
  name: j.name,
  type: j.type,
  status: j.status,
  ...(j.outputs !== null && Object.keys(j.outputs).length > 0 ? { outputs: j.outputs } : {}),
  ...(j.turtleBuild === null ? {} : { buildId: j.turtleBuild.id }),
  ...(j.turtleJobRun === null || j.turtleJobRun.artifacts.length === 0
    ? {}
    : { artifacts: j.turtleJobRun.artifacts.map((a) => ({ name: a.name, filename: a.filename, bytes: a.fileSizeBytes, url: a.downloadUrl })) }),
  hasLog: logUrlsOf(j).length > 0,
});

/** Where a job's log is: its own run's files, else (a build job) its build's. A log may span several files, in order. */
export const logUrlsOf = (j: RawWorkflowJob): readonly string[] =>
  j.turtleJobRun !== null && j.turtleJobRun.logFileUrls.length > 0 ? j.turtleJobRun.logFileUrls : (j.turtleBuild?.logFiles ?? []);

/**
 * Apple's (or Google's) words for a failed submission. A submission made by a
 * workflow job keeps them on the JOB (`turtleJobRun.errors`), and its own
 * `error` stays null, so `eas submission:view` prints nothing.
 */
export const submissionError = (s: RawSubmission): string | null => {
  const own = s.error?.message;
  if (own) return s.error?.errorCode ? `${s.error.errorCode}: ${own}` : own;
  const fromJob = s.workflowJob?.turtleJobRun?.errors.find((e) => !/^Unknown error\. See logs/i.test(e.message)) ?? s.workflowJob?.turtleJobRun?.errors[0];
  return fromJob === undefined ? null : `${fromJob.errorCode}: ${fromJob.message}`;
};

export const submissionView = (s: RawSubmission) => ({
  id: s.id,
  status: s.status,
  platform: s.platform,
  createdAt: s.createdAt,
  completedAt: s.completedAt,
  build: s.submittedBuild === null
    ? null
    : {
        id: s.submittedBuild.id,
        appIdentifier: s.submittedBuild.appIdentifier,
        appVersion: s.submittedBuild.appVersion,
        buildNumber: s.submittedBuild.appBuildVersion,
        profile: s.submittedBuild.buildProfile,
      },
  ...(s.iosConfig === null ? {} : { ascAppId: s.iosConfig.ascAppIdentifier }),
  ...(s.androidConfig === null ? {} : { track: s.androidConfig.track, releaseStatus: s.androidConfig.releaseStatus, rollout: s.androidConfig.rollout }),
  by: s.initiatingActor?.displayName ?? null,
  ...(s.workflowJob === null ? {} : { workflowRunId: s.workflowJob.workflowRun.id, workflowJob: s.workflowJob.key }),
  error: submissionError(s),
});

/** A submission's log: its own files (the controller's, then the worker's), else those of the workflow job that made it. */
export const submissionLogUrls = (s: RawSubmission): readonly string[] =>
  s.logFiles.length > 0 ? s.logFiles : (s.workflowJob?.turtleJobRun?.logFileUrls ?? []);
