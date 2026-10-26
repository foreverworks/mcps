/**
 * Shared test plumbing: a fake EAS that answers the server's GraphQL by
 * operation name, and log files by URL, through a stubbed fetch. The isolation
 * setup refuses every other request, and no token reaches a real account: the
 * token is a literal in a temp file.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { vi } from "vitest";

import { asAppError } from "../src/domain/errors.js";
import type { RawBuild, RawCredentials, RawWorkflowJob, RawWorkflowRunWithJobs } from "../src/domain/schema.js";

export const APP_ID = "0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0";
export const GRAPHQL = "https://api.expo.dev/graphql";
export const LOG_URL = "https://storage.googleapis.com/eas-workflows-production/logs/submit.txt";

export const tokenFile = (token = "robot-token-1"): string => {
  const dir = mkdtempSync(join(tmpdir(), "eas-token-"));
  const file = join(dir, "expo-token");
  writeFileSync(file, `${token}\n`);
  return file;
};

export const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export type Call = { readonly url: string; readonly operation?: string; readonly variables?: Record<string, unknown>; readonly authorization?: string };

export type Handler = (variables: Record<string, unknown>) => unknown;

/**
 * A fake EAS: `handlers` by operation name return `data` (or a Response, for an
 * error); `logs` by URL return a log file's text. `calls` records everything.
 */
export const fakeEas = (handlers: Readonly<Record<string, Handler>>, logs: Readonly<Record<string, string>> = {}) => {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const authorization = new Headers(init?.headers).get("authorization") ?? undefined;
      if (url === GRAPHQL) {
        const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
        const operation = /^\s*(?:query|mutation)\s+(\w+)/.exec(body.query)?.[1] ?? "?";
        calls.push({ url, operation, variables: body.variables, ...(authorization === undefined ? {} : { authorization }) });
        const handler = handlers[operation];
        if (handler === undefined) return json({ errors: [{ message: `no fake for ${operation}`, extensions: { errorCode: "UNEXPECTED_ERROR", errorType: "SYSTEM" } }] });
        const out = handler(body.variables);
        return out instanceof Response ? out : json({ data: out });
      }
      calls.push({ url, ...(authorization === undefined ? {} : { authorization }) });
      const text = logs[url];
      return text === undefined ? new Response("not found", { status: 404 }) : new Response(text, { status: 200, headers: { "content-type": "text/plain" } });
    }),
  );
  return calls;
};

export const gqlError = (message: string, extensions: Record<string, unknown>, status = 200): Response => json({ errors: [{ message, extensions }], data: null }, status);

export const errorOf = async (run: () => unknown) => {
  try {
    await run();
    return undefined;
  } catch (thrown) {
    return asAppError(thrown);
  }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const parse = (result: unknown): any => JSON.parse((result as { content: { text: string }[] }).content[0]?.text ?? "{}");

// ---- fixtures: the least of each EAS object the code reads ---------------------------------------

export const APP = { id: APP_ID, fullName: "@acme/habits", slug: "habits", name: "Habits" };

export const ME = { meActor: { __typename: "Robot", id: "robot-1", displayName: "ci-robot (test)", accounts: [{ id: "acct-1", name: "acme" }] } };

export const ACCOUNT_APPS = { account: { byName: { appsPaginated: { pageInfo: { hasNextPage: false, endCursor: null }, edges: [{ node: APP }] } } } };

/** A log line as the builder writes it. */
export const logLine = (step: string, msg: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ name: "worker", phase: "CUSTOM", buildStepDisplayName: step, level: 30, msg, time: "2026-01-15T10:09:30.000Z", ...extra });

/** A failed submit job's log, cut to what matters. */
export const SUBMIT_LOG = [
  JSON.stringify({ phase: "SPIN_UP_BUILDER", marker: "START_PHASE", msg: "Start phase: SPIN_UP_BUILDER", level: 30 }),
  JSON.stringify({ phase: "SPIN_UP_BUILDER", marker: "END_PHASE", result: "success", msg: "End phase: SPIN_UP_BUILDER", level: 30 }),
  logLine("Download build", 'Executing build step "Download build"', { marker: "start-step" }),
  logLine("Download build", "Downloading build b0b0b0b0...", {}),
  logLine("Download build", 'Finished build step "Download build" successfully', { marker: "end-step", result: "success" }),
  logLine("Prepare credentials", 'Executing build step "Prepare credentials"', { marker: "start-step" }),
  logLine("Prepare credentials", 'eas-cli failed to resolve submission config. Add EXPO_DEBUG: "1" to the job env to see the error.', { source: "stdout" }),
  logLine("Prepare credentials", "/bin/bash -eo pipefail /tmp/x.sh exited with non-zero code: 1", { level: 50, err: { message: "exited" } }),
  logLine("Prepare credentials", 'Build step "Prepare credentials" failed', { marker: "end-step", result: "fail", level: 50 }),
  logLine("Submit", 'Skipped build step "Submit"', { marker: "end-step", result: "skipped" }),
  "{not json",
].join("\n");

export const job = (over: Partial<RawWorkflowJob> = {}): RawWorkflowJob => ({
  id: "job-submit",
  key: "submit_ios",
  name: "Submit to TestFlight",
  status: "FAILURE",
  type: "SUBMISSION",
  outputs: { ios_bundle_identifier: "com.example.habits.dev" },
  createdAt: "2026-01-15T10:09:00.000Z",
  updatedAt: "2026-01-15T10:10:00.000Z",
  errors: [],
  turtleJobRun: { id: "jr-1", logFileUrls: [LOG_URL], errors: [{ errorCode: "UNKNOWN_ERROR", message: "Unknown error. See logs for more information." }], artifacts: [] },
  turtleBuild: null,
  ...over,
});

export const run = (over: Partial<RawWorkflowRunWithJobs> = {}): RawWorkflowRunWithJobs => ({
  id: "run-failed",
  status: "FAILURE",
  gitCommitHash: "1111111111111111111111111111111111111111",
  gitCommitMessage: "chore: bump version\n\nbody",
  requestedGitRef: "refs/heads/main",
  triggerEventType: "GITHUB_PUSH",
  triggeringSchedule: null,
  createdAt: "2026-01-15T10:00:00.000Z",
  updatedAt: "2026-01-15T10:10:00.000Z",
  errors: [],
  actor: { __typename: "Robot", displayName: "GitHub App · @acme" },
  workflow: { fileName: "ios-build.yml", name: "iOS build" },
  jobs: [
    job({ id: "job-build", key: "build_ios", name: "Build", status: "SUCCESS", type: "BUILD", turtleJobRun: null, outputs: { build_id: "build-dev" } }),
    job(),
  ],
  ...over,
});

export const build = (over: Partial<RawBuild> = {}): RawBuild => ({
  id: "build-dev",
  status: "FINISHED",
  platform: "IOS",
  buildProfile: "preview",
  appIdentifier: "com.example.habits.dev",
  appVersion: "1.0.0",
  appBuildVersion: "12",
  distribution: "STORE",
  gitCommitHash: "1111111111111111111111111111111111111111",
  createdAt: "2026-01-15T10:01:00.000Z",
  completedAt: "2026-01-15T10:09:00.000Z",
  error: null,
  fingerprint: { hash: "f1a2b3c4" },
  runtime: { version: "f1a2b3c4" },
  initiatingActor: { __typename: "Robot", displayName: "GitHub App · @acme" },
  app: APP,
  sdkVersion: "57.0.0",
  isForIosSimulator: false,
  gitCommitMessage: "chore: bump version",
  message: null,
  updatedAt: "2026-01-15T10:09:00.000Z",
  expirationDate: null,
  artifacts: { buildUrl: null, applicationArchiveUrl: "https://expo.dev/artifacts/eas/x.ipa", xcodeBuildLogsUrl: null, buildArtifactsUrl: null },
  updateChannel: null,
  logFiles: [],
  metrics: null,
  ...over,
});

export const KEY = { id: "a5c0ffee-0000-4000-8000-000000000001", keyIdentifier: "ABCDE12345", issuerIdentifier: "155e0000-0000-4000-8000-000000000002", name: "apple@example.com" };

const distribution = [
  {
    iosDistributionType: "APP_STORE",
    distributionCertificate: { serialNumber: "1A2B", developerPortalIdentifier: "CERT000001", validityNotAfter: "2030-06-30T12:00:00.000Z" },
    provisioningProfile: { developerPortalIdentifier: "PROF000001", expiration: "2030-06-30T12:00:00.000Z", status: "active" },
  },
];

/** A project's credentials where the dev bundle has no submit key: the case audit_credentials exists for. */
export const credentials = (devKey: typeof KEY | null = null): RawCredentials => ({
  ios: [
    {
      id: "cred-ios-prod",
      appleTeam: { appleTeamIdentifier: "TEAM000001", appleTeamName: null },
      appleAppIdentifier: { bundleIdentifier: "com.example.habits" },
      pushKey: null,
      appStoreConnectApiKeyForSubmissions: KEY,
      iosAppBuildCredentialsList: distribution,
    },
    {
      id: "cred-ios-dev",
      appleTeam: null,
      appleAppIdentifier: { bundleIdentifier: "com.example.habits.dev" },
      pushKey: null,
      appStoreConnectApiKeyForSubmissions: devKey,
      iosAppBuildCredentialsList: distribution,
    },
  ],
  android: [
    {
      id: "cred-android",
      applicationIdentifier: "com.example.habits",
      androidFcm: null,
      googleServiceAccountKeyForFcmV1: null,
      googleServiceAccountKeyForSubmissions: { id: "sa-1", clientEmail: "eas-submit@example-project.iam.gserviceaccount.com", projectIdentifier: "example-project" }, // personal-data-check: allow (an invented service account)
      androidAppBuildCredentialsList: [{ name: "Build Credentials", isDefault: true, androidKeystore: { type: "JKS", keyAlias: "upload", sha1CertificateFingerprint: "AA:BB", sha256CertificateFingerprint: "CC:DD" } }],
    },
  ],
});

export const DEV_WORKFLOW = `
name: iOS build
on:
  workflow_dispatch: {}
jobs:
  fingerprint:
    type: fingerprint
  get_ios_build:
    needs: [fingerprint]
    type: get-build
    params:
      platform: ios
      profile: preview
  build_ios:
    needs: [get_ios_build]
    if: \${{ !needs.get_ios_build.outputs.build_id }}
    type: build
    params:
      platform: ios
      profile: preview
  submit_ios:
    needs: [build_ios]
    type: submit
    params:
      build_id: \${{ needs.build_ios.outputs.build_id }}
`;
