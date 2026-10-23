/**
 * The server as a client sees it, through the kit's guard, end to end against
 * a fake EAS: from a tool's arguments to the GraphQL variables EAS receives,
 * and the line the user confirms for the one tool that spends credits.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ACCESS_META, checkPolicy, confirmingClient, connectInMemory, guard, type GuardSettings, McpServer } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import { buildDeps } from "../src/composition.js";
import { asAppError, remedyFor } from "../src/domain/errors.js";
import { policyFor } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";
import { ACCOUNT_APPS, APP, APP_ID, build, credentials, DEV_WORKFLOW, type Handler, fakeEas, gqlError, job, KEY, LOG_URL, ME, parse, run, SUBMIT_LOG, tokenFile } from "./helpers.js";

const CONFIRMING: GuardSettings = { maxAccess: "money", confirm: "elicit" };

/** The server through the guard; the client confirms what `answer` says and records every line it was shown. */
const connected = async (
  env: NodeJS.ProcessEnv = { EXPO_TOKEN_FILE: tokenFile() },
  settings: GuardSettings = CONFIRMING,
  answer: (line: string) => boolean = () => true,
) => {
  const deps = buildDeps(env, { sleep: async () => undefined });
  const server = new McpServer({ name: "eas", version: "test" });
  registerAll(guard(server, { service: "eas", policy: policyFor(deps), settings, log: () => undefined, vocabulary: { asAppError, remedyFor } }), deps);
  const { client, asked } = confirmingClient("test", answer);
  await connectInMemory(server, client);
  return { call: async (name: string, args: Record<string, unknown> = {}) => parse(await client.callTool({ name, arguments: args })), client, asked };
};

const BASE: Readonly<Record<string, Handler>> = {
  Me: () => ME,
  AccountApps: () => ACCOUNT_APPS,
  Workflows: () => ({ app: { byId: { workflows: [{ id: "wf-dev", name: "iOS build", fileName: "ios-build.yml", createdAt: "", updatedAt: "" }] } } }),
};

describe("the eas server", () => {
  it("classifies every tool, and gates exactly the one that spends build credits", async () => {
    const deps = buildDeps({});
    expect(() => checkPolicy("eas", (s) => registerAll(s, deps), policyFor(deps))).not.toThrow();
    const { client } = await connected();
    const { tools } = await client.listTools();
    expect(tools.filter((t) => t._meta?.[ACCESS_META] === "money").map((t) => t.name)).toEqual(["dispatch_workflow"]);
  });

  it("lists a workflow's runs with the reason each failed run failed, read from its log", async () => {
    const calls = fakeEas(
      {
        ...BASE,
        Runs: () => ({ app: { byId: { workflowRunsPaginated: { pageInfo: { hasNextPage: false, endCursor: null }, edges: [{ node: run() }, { node: run({ id: "run-ok", status: "SUCCESS" }) }] } } } }),
        Run: () => ({ workflowRuns: { byId: run() } }),
      },
      { [LOG_URL]: SUBMIT_LOG },
    );
    const { call } = await connected();
    const out = await call("list_workflow_runs", { workflow: "ios-build", limit: 5 });
    expect(out.project).toBe("@acme/habits");
    expect(out.runs[0]).toMatchObject({
      id: "run-failed",
      status: "FAILURE",
      gitRef: "refs/heads/main",
      gitCommitMessage: "chore: bump version",
      reason: 'submit_ios > Prepare credentials: eas-cli failed to resolve submission config. Add EXPO_DEBUG: "1" to the job env to see the error.',
    });
    expect(out.runs[1].reason).toBeUndefined();
    expect(calls.find((c) => c.operation === "Runs")?.variables).toEqual({ appId: APP_ID, first: 5, filter: { workflowId: "wf-dev" } });
  });

  it("names the workflows a project has when asked for one it does not", async () => {
    fakeEas(BASE);
    const out = await (await connected()).call("list_workflow_runs", { workflow: "nope.yml" });
    expect(out.error).toMatchObject({ kind: "not_found", message: expect.stringContaining("ios-build.yml") });
  });

  it("shows a failed run's jobs, outputs and the failed step's tail", async () => {
    fakeEas({ Run: () => ({ workflowRuns: { byId: run() } }) }, { [LOG_URL]: SUBMIT_LOG });
    const out = await (await connected()).call("get_workflow_run", { run: "run-failed", lines: 2 });
    expect(out.jobs.map((j: { key: string; status: string }) => [j.key, j.status])).toEqual([
      ["build_ios", "SUCCESS"],
      ["submit_ios", "FAILURE"],
    ]);
    expect(out.failures[0]).toMatchObject({ job: "submit_ios", step: "Prepare credentials", tail: expect.arrayContaining(['Build step "Prepare credentials" failed']) });
  });

  it("answers every list as typed structured content, the same JSON as its text", async () => {
    const submission = {
      id: "sub-1",
      status: "ERRORED",
      platform: "IOS",
      createdAt: "2026-10-01T09:00:00.000Z",
      completedAt: null,
      error: { errorCode: "SUBMISSION_SERVICE_IOS_ERROR", message: "Missing compliance" },
      iosConfig: { ascAppIdentifier: "1234567890" },
      androidConfig: null,
      submittedBuild: { id: "build-dev", appIdentifier: "com.example.habits.dev", appVersion: "1.0.0", appBuildVersion: "12", buildProfile: "production" },
      logFiles: [],
      initiatingActor: null,
      workflowJob: { id: "job-1", key: "submit_ios", workflowRun: { id: "run-failed" }, turtleJobRun: null },
    };
    const update = {
      id: "u1",
      group: "g1",
      platform: "ios",
      message: "fix: a crash\nlonger text",
      createdAt: "2026-10-01T09:00:00.000Z",
      runtime: { version: "r1" },
      gitCommitHash: null,
      rolloutPercentage: 50,
      isRollBackToEmbedded: false,
      actor: { __typename: "User", displayName: "ana" },
    };
    fakeEas({
      ...BASE,
      Builds: () => ({ app: { byId: { builds: [build(), build({ id: "b-a", platform: "ANDROID", error: { errorCode: "E", message: "failed", docsUrl: null } })] } } }),
      Runs: () => ({ app: { byId: { workflowRunsPaginated: { pageInfo: { hasNextPage: true, endCursor: "c2" }, edges: [{ node: run({ id: "run-ok", status: "SUCCESS" }) }] } } } }),
      Submissions: () => ({ app: { byId: { submissions: [submission, { ...submission, id: "sub-2", platform: "ANDROID", iosConfig: null, androidConfig: { track: "internal", releaseStatus: null, rollout: null }, workflowJob: null }] } } }),
      Fingerprints: () => ({
        app: {
          byId: {
            fingerprintsPaginated: {
              edges: [
                {
                  node: {
                    hash: "fp1",
                    createdAt: "2026-10-01T09:00:00.000Z",
                    buildCount: 1,
                    updateCount: 1,
                    builds: { edges: [{ node: { id: "build-dev", platform: "IOS", buildProfile: null, status: "FINISHED", appBuildVersion: "12", createdAt: "2026-10-01T09:00:00.000Z" } }] },
                    updates: { edges: [{ node: { group: "g1", platform: "ios", createdAt: "2026-10-01T09:00:00.000Z", branch: { name: "production" } } }] },
                  },
                },
              ],
            },
          },
        },
      }),
      Updates: () => ({
        app: {
          byId: {
            updateChannels: [{ id: "c1", name: "production", isPaused: true, isProtected: false, branchMapping: JSON.stringify({ data: [{ branchId: "b-prod" }] }) }],
            updateBranches: [{ id: "b-prod", name: "production", updates: [update, { ...update, id: "u2", platform: "android", rolloutPercentage: null, isRollBackToEmbedded: true }] }],
          },
        },
      }),
    });
    const { client } = await connected();
    for (const [name, args] of [
      ["list_projects", {}],
      ["list_builds", { limit: 2 }],
      ["list_workflows", {}],
      ["list_workflow_runs", { limit: 1 }],
      ["list_submissions", { limit: 2 }],
      ["list_fingerprints", {}],
      ["list_updates", {}],
    ] as const) {
      const result = (await client.callTool({ name, arguments: args })) as unknown as { content: [{ text: string }]; structuredContent?: unknown; isError?: boolean };
      expect([name, result.isError, result.structuredContent]).toEqual([name, undefined, JSON.parse(result.content[0].text)]);
    }
  });

  it("audits credentials per bundle and package, naming the dev bundle's missing submit key", async () => {
    fakeEas({
      ...BASE,
      Credentials: () => ({ app: { byId: { iosAppCredentials: credentials().ios, androidAppCredentials: credentials().android } } }),
      Builds: () => ({ app: { byId: { builds: [build(), build({ id: "b-a", platform: "ANDROID", appIdentifier: "com.example.habits" })] } } }),
    });
    const out = await (await connected()).call("audit_credentials");
    expect(out.ok).toBe(false);
    expect(out.missing).toEqual([expect.stringMatching(/^ios com\.example\.habits\.dev: no App Store Connect API key for submissions/)]);
    expect(out.identifiers.map((i: { platform: string; identifier: string }) => `${i.platform} ${i.identifier}`)).toEqual([
      "android com.example.habits",
      "ios com.example.habits",
      "ios com.example.habits.dev",
    ]);
    expect(JSON.stringify(out)).not.toMatch(/certificateP12|keystorePassword|keyP8/);
  });

  it("sets the submit key by its Apple key id and reads the bundle back", async () => {
    const calls = fakeEas({
      ...BASE,
      Credentials: () => ({ app: { byId: { iosAppCredentials: credentials().ios, androidAppCredentials: [] } } }),
      AscKeys: () => ({ account: { byName: { appStoreConnectApiKeysPaginated: { edges: [{ node: KEY }] } } } }),
      SetSubmitKey: () => ({ iosAppCredentials: { setAppStoreConnectApiKeyForSubmissions: credentials(KEY).ios[1] } }),
    });
    const out = await (await connected()).call("set_submit_key", { bundle_id: "com.example.habits.dev", key: "ABCDE12345" });
    expect(out).toMatchObject({ before: null, audit: { ok: true, submitKey: { keyId: "ABCDE12345" } } });
    expect(calls.find((c) => c.operation === "SetSubmitKey")?.variables).toEqual({ id: "cred-ios-dev", keyId: KEY.id });
    expect(calls.find((c) => c.operation === "AscKeys")?.variables).toEqual({ accountName: "acme" });
  });

  it("refuses a key the account does not hold, a key that is no key id, and set together with clear", async () => {
    const calls = fakeEas({
      ...BASE,
      Credentials: () => ({ app: { byId: { iosAppCredentials: credentials().ios, androidAppCredentials: [] } } }),
      AscKeys: () => ({ account: { byName: { appStoreConnectApiKeysPaginated: { edges: [{ node: KEY }] } } } }),
    });
    const { call, client } = await connected();
    const malformed = (await client.callTool({ name: "set_submit_key", arguments: { bundle_id: "com.example.habits.dev", key: "NOPE" } })) as { isError?: boolean; content: { text: string }[] };
    expect(malformed.isError).toBe(true);
    expect(malformed.content[0]?.text).toMatch(/Apple key id/);
    expect(calls).toHaveLength(0);
    expect((await call("set_submit_key", { bundle_id: "com.example.habits.dev", key: "ZZZZZZZZZZ" })).error).toMatchObject({ kind: "not_found", message: expect.stringContaining("ABCDE12345") });
    expect((await call("set_submit_key", { bundle_id: "com.example.habits.dev", key: "ABCDE12345", clear: true })).error).toMatchObject({ kind: "input" });
  });

  it("submits an existing iOS build with the bundle's own key and the ASC app Apple names for it", async () => {
    const calls = fakeEas({
      Build: () => ({ builds: { byId: build() } }),
      Credentials: () => ({ app: { byId: { iosAppCredentials: credentials(KEY).ios, androidAppCredentials: [] } } }),
      AscApps: () => ({ appStoreConnectApiKey: { byId: { remoteAppStoreConnectApps: [{ ascAppIdentifier: "1234567890", bundleIdentifier: "com.example.habits.dev" }] } } }),
      SubmitIos: () => ({
        submission: {
          createIosSubmission: {
            submission: {
              id: "sub-1",
              status: "IN_QUEUE",
              platform: "IOS",
              createdAt: "",
              completedAt: null,
              error: null,
              iosConfig: { ascAppIdentifier: "1234567890" },
              androidConfig: null,
              submittedBuild: null,
              logFiles: [],
              initiatingActor: null,
              workflowJob: null,
            },
          },
        },
      }),
    });
    const out = await (await connected()).call("submit_build", { build: "build-dev", what_to_test: "new onboarding", expect_version: "1.0.0", expect_build_number: "12" });
    expect(out).toMatchObject({
      project: APP.fullName,
      build: { id: "build-dev", platform: "IOS", profile: "preview", appVersion: "1.0.0", buildNumber: "12", commit: "1111111111111111111111111111111111111111", commitMessage: "chore: bump version" },
      submission: { id: "sub-1", status: "IN_QUEUE", ascAppId: "1234567890" },
    });
    expect(calls.find((c) => c.operation === "SubmitIos")?.variables).toEqual({
      input: { appId: APP_ID, submittedBuildId: "build-dev", config: { ascAppIdentifier: "1234567890", ascApiKeyId: KEY.id, changelog: "new onboarding" } },
    });
  });

  it("refuses a build that is not the version or build number the caller expected, before reading credentials", async () => {
    const calls = fakeEas({ Build: () => ({ builds: { byId: build() } }) });
    const { call } = await connected();
    const version = await call("submit_build", { build: "build-dev", expect_version: "1.0.1" });
    expect(version.error).toMatchObject({
      kind: "input",
      message: "build build-dev (IOS, preview, commit 111111111111) has app version 1.0.0, not 1.0.1; nothing was submitted (check the build id with list_builds)",
    });
    const both = await call("submit_build", { build: "build-dev", expect_version: "2.0.0", expect_build_number: "8" });
    expect(both.error.message).toContain("app version 1.0.0, not 2.0.0 and build number 12, not 8");
    expect(calls.map((c) => c.operation)).toEqual(["Build", "Build"]);
  });

  it("refuses to submit before scheduling anything when the bundle has no submit key, or the build is not finished", async () => {
    const calls = fakeEas({
      Build: (v) => ({ builds: { byId: v["buildId"] === "running" ? build({ status: "IN_PROGRESS" }) : build() } }),
      Credentials: () => ({ app: { byId: { iosAppCredentials: credentials().ios, androidAppCredentials: [] } } }),
    });
    const { call } = await connected();
    expect((await call("submit_build", { build: "build-dev" })).error).toMatchObject({ kind: "input", message: expect.stringContaining("set_submit_key") });
    expect((await call("submit_build", { build: "running" })).error).toMatchObject({ kind: "input", message: expect.stringContaining("IN_PROGRESS") });
    expect(calls.some((c) => c.operation === "SubmitIos")).toBe(false);
  });

  it("confirms a dispatch with the user in a line naming the builds, then runs exactly that revision", async () => {
    const calls = fakeEas({
      ...BASE,
      RevisionAt: () => ({
        workflowRevision: { getOrCreateWorkflowRevisionFromGitRef: { id: "rev-dev", blobSha: "b10b0001", commitSha: "c0ffee01", yamlConfig: DEV_WORKFLOW, workflow: { fileName: "ios-build.yml", name: "x" } } },
      }),
      Dispatch: () => ({ workflowRun: { createWorkflowRunFromGitRef: { ...run({ id: "run-new", status: "NEW" }), jobs: undefined } } }),
    });
    const { call, asked } = await connected();
    const ran = await call("dispatch_workflow", { workflow: "ios-build.yml", git_ref: "main" });
    expect(asked).toEqual([
      "eas: Run EAS workflow ios-build.yml of @acme/habits at main: builds ios preview (if its condition holds); may spend EAS build credits.",
    ]);
    expect(ran).toMatchObject({ run: { id: "run-new", status: "NEW" }, builds: [{ key: "build_ios", conditional: true }] });
    // The revision resolved for the line is the one dispatched: looked up when asking and again with
    // the answer, which runs only if it is still the one confirmed; one dispatch.
    expect(calls.filter((c) => c.operation === "RevisionAt")).toHaveLength(2);
    expect(calls.filter((c) => c.operation === "Dispatch").map((c) => c.variables)).toEqual([{ revisionId: "rev-dev", gitRef: "main" }]);
  });

  it("dispatches nothing the user declined", async () => {
    const calls = fakeEas({
      ...BASE,
      RevisionAt: () => ({
        workflowRevision: { getOrCreateWorkflowRevisionFromGitRef: { id: "rev-dev", blobSha: "b10b0001", commitSha: "c0ffee01", yamlConfig: DEV_WORKFLOW, workflow: { fileName: "ios-build.yml", name: "x" } } },
      }),
    });
    const out = await (await connected(undefined, CONFIRMING, () => false)).call("dispatch_workflow", { workflow: "ios-build.yml", git_ref: "main" });
    expect(out.error).toMatchObject({ kind: "confirmation_denied" });
    expect(calls.some((c) => c.operation === "Dispatch")).toBe(false);
  });

  it("refuses a dispatch at something that is not a git ref before asking anyone", async () => {
    fakeEas(BASE);
    const { call, asked } = await connected();
    const out = await call("dispatch_workflow", { workflow: "ios-build.yml", git_ref: "main; rm -rf /" });
    expect(out.error).toMatchObject({ kind: "input" });
    expect(asked).toEqual([]);
  });

  it("refuses a dispatch on a server capped below money, before reaching EAS", async () => {
    const calls = fakeEas(BASE);
    const out = await (await connected(undefined, { maxAccess: "write", confirm: "client" })).call("dispatch_workflow", { workflow: "ios-build.yml", git_ref: "main" });
    expect(out.error).toMatchObject({ kind: "access_denied" });
    expect(calls).toEqual([]);
  });

  describe("republish_update", () => {
    const COMMIT = "abcdef0123456789abcdef0123456789abcdef01";
    const channel = { id: "c1", name: "production", isPaused: false, isProtected: false, branchMapping: JSON.stringify({ data: [{ branchId: "b-prod" }] }) };
    const groupUpdate = (over: Record<string, unknown> = {}) => ({
      id: "u1",
      group: "g-old",
      app: { id: APP.id, fullName: APP.fullName },
      platform: "ios",
      message: "feat: earlier\n\nbody",
      createdAt: "2026-10-01T09:00:00.000Z",
      manifestFragment: '{"launchAsset":{}}',
      isRollBackToEmbedded: false,
      gitCommitHash: COMMIT,
      isGitWorkingTreeDirty: false,
      environment: "production",
      manifestHostOverride: null,
      assetHostOverride: null,
      runtime: { version: "r1" },
      branch: { id: "b-prev", name: "preview" },
      codeSigningInfo: null,
      rolloutControlUpdate: null,
      fingerprint: null,
      ...over,
    });
    const easWith = (group: readonly unknown[]) =>
      fakeEas({
        ...BASE,
        Updates: () => ({ app: { byId: { updateChannels: [channel], updateBranches: [{ id: "b-prod", name: "production", updates: [] }] } } }),
        UpdateGroup: () => ({ updatesByGroup: group }),
        PublishGroup: () => ({ updateBranch: { publishUpdateGroups: [{ id: "u-new", group: "g-new", platform: "ios" }] } }),
      });

    it("puts a group on a branch from its own manifests, saying where the group came from", async () => {
      const calls = easWith([groupUpdate()]);
      const out = await (await connected()).call("republish_update", { group: "g-old", branch: "production", expect_commit: "ABCDEF0" });
      expect(out).toMatchObject({
        branch: "production",
        productionChannels: ["production"],
        group: "g-new",
        runtimeVersion: "r1",
        source: { group: "g-old", project: APP.fullName, branch: "preview", platforms: ["ios"], commit: COMMIT, message: "feat: earlier", createdAt: "2026-10-01T09:00:00.000Z" },
      });
      expect(calls.find((c) => c.operation === "PublishGroup")?.variables).toMatchObject({
        input: [{ branchId: "b-prod", runtimeVersion: "r1", updateInfoGroup: { ios: { launchAsset: {} } }, awaitingCodeSigningInfo: false }],
      });
    });

    it("refuses a group of another project, and one not published from the expected commit, publishing nothing", async () => {
      const elsewhere = easWith([groupUpdate({ app: { id: "other-app", fullName: "@acme/other" } })]);
      const { call, client } = await connected();
      expect((await call("republish_update", { group: "g-old", branch: "production" })).error).toMatchObject({
        kind: "input",
        message: expect.stringContaining("update group g-old belongs to @acme/other, not @acme/habits"),
      });
      expect(elsewhere.some((c) => c.operation === "PublishGroup")).toBe(false);

      const other = easWith([groupUpdate()]);
      expect((await call("republish_update", { group: "g-old", branch: "production", expect_commit: "1234567" })).error).toMatchObject({
        kind: "input",
        message: `update group g-old was published from commit ${COMMIT}, not 1234567; nothing was republished`,
      });
      const short = await client.callTool({ name: "republish_update", arguments: { group: "g-old", branch: "production", expect_commit: "abc" } });
      expect(short.isError).toBe(true);
      expect(JSON.stringify(short.content)).toContain("at least 7 hex characters");
      expect(other.some((c) => c.operation === "PublishGroup")).toBe(false);
    });
  });

  describe("validate_workflow", () => {
    const revision = (yamlConfig: string) => () => ({
      workflowRevision: { getOrCreateWorkflowRevisionFromGitRef: { id: "rev-dev", blobSha: "b10b0001", commitSha: "c0ffee01", yamlConfig, workflow: { fileName: "ios-build.yml", name: "x" } } },
    });
    const accepted = () => ({ workflowRevision: { validateWorkflowYamlConfig: true } });
    const refused = (metadata: Record<string, unknown>) => () => gqlError("Invalid workflow", { errorCode: "VALIDATION_ERROR", errorType: "USER", metadata });

    it("checks the file the repository has at a ref with EAS's validator, naming its jobs and the builds a dispatch would spend on", async () => {
      const calls = fakeEas({ ...BASE, RevisionAt: revision(DEV_WORKFLOW), ValidateWorkflow: accepted });
      const out = await (await connected()).call("validate_workflow", { workflow: "ios-build", git_ref: "main" });
      expect(out).toMatchObject({
        project: APP.fullName,
        source: { workflow: "ios-build.yml", gitRef: "main", commit: "c0ffee01" },
        valid: true,
        issues: [],
        builds: [{ key: "build_ios", platform: "ios", profile: "preview", conditional: true }],
      });
      expect(out.jobs.map((j: { key: string }) => j.key)).toEqual(["fingerprint", "get_ios_build", "build_ios", "submit_ios"]);
      expect(calls.find((c) => c.operation === "ValidateWorkflow")?.variables).toEqual({ appId: APP_ID, yamlConfig: DEV_WORKFLOW });
      expect(calls.some((c) => c.operation === "Dispatch")).toBe(false);
    });

    it("lists each problem EAS's validator names, field by field, as the answer rather than a failure", async () => {
      fakeEas({ ...BASE, RevisionAt: revision(DEV_WORKFLOW), ValidateWorkflow: refused({ formErrors: ["Unknown key: concurrency"], fieldErrors: { "jobs.build_ios.params.platform": ["Required"] } }) });
      const out = await (await connected()).call("validate_workflow", { workflow: "ios-build.yml", git_ref: "refs/heads/main" });
      expect(out).toMatchObject({ valid: false, issues: ["Unknown key: concurrency", "jobs.build_ios.params.platform: Required"] });
    });

    it("answers a file EAS already refuses to read at the ref with EAS's issues", async () => {
      fakeEas({ ...BASE, RevisionAt: refused({ formErrors: ["jobs must be a mapping"], fieldErrors: {} }) });
      const out = await (await connected()).call("validate_workflow", { workflow: "new-flow.yml", git_ref: "feature/x" });
      expect(out).toEqual({ project: APP.fullName, source: { workflow: "new-flow.yml", gitRef: "feature/x", commit: null }, valid: false, issues: ["jobs must be a mapping"] });
    });

    it("checks a file by path inside the server's roots, with its checksum, and finds a needs: naming no job", async () => {
      const roots = mkdtempSync(join(tmpdir(), "eas-inbox-"));
      const yaml = "jobs:\n  build:\n    type: build\n    params: { platform: android, profile: production }\n  submit:\n    type: submit\n    needs: [biuld]\n";
      writeFileSync(join(roots, "android.yml"), yaml);
      const calls = fakeEas({ ...BASE, ValidateWorkflow: accepted });
      const out = await (await connected({ EXPO_TOKEN_FILE: tokenFile(), MCP_FILE_ROOTS: roots })).call("validate_workflow", { path: "android.yml" });
      expect(out).toMatchObject({
        source: { file: "android.yml", sha256: createHash("sha256").update(yaml).digest("hex"), size: Buffer.byteLength(yaml) },
        valid: false,
        issues: ['jobs.submit.needs: there is no job "biuld"'],
        builds: [{ key: "build", platform: "android", profile: "production", conditional: false }],
      });
      expect(calls.some((c) => c.operation === "RevisionAt")).toBe(false);
    });

    it("answers YAML that does not parse without asking EAS, and a file that is not named .yml", async () => {
      const roots = mkdtempSync(join(tmpdir(), "eas-inbox-"));
      writeFileSync(join(roots, "broken.txt"), "jobs: [unclosed\n");
      const calls = fakeEas(BASE);
      const out = await (await connected({ EXPO_TOKEN_FILE: tokenFile(), MCP_FILE_ROOTS: roots })).call("validate_workflow", { path: "broken.txt" });
      expect(out.valid).toBe(false);
      expect(out.issues).toEqual(["broken.txt: a workflow file's name ends in .yml or .yaml", expect.stringMatching(/^the file is not valid YAML: /)]);
      expect(out.jobs).toBeUndefined();
      expect(calls.some((c) => c.operation === "ValidateWorkflow")).toBe(false);
    });

    it("takes a file at a ref or a file, never both nor half of one", async () => {
      const calls = fakeEas(BASE);
      const { call } = await connected();
      expect((await call("validate_workflow", { workflow: "a.yml", git_ref: "main", path: "a.yml" })).error).toMatchObject({ kind: "input" });
      expect((await call("validate_workflow", { workflow: "a.yml" })).error).toMatchObject({ kind: "input", message: "a file at a ref needs both workflow and git_ref" });
      expect((await call("validate_workflow", { workflow: "a.yml", git_ref: "main; rm -rf /" })).error).toMatchObject({ kind: "input" });
      expect(calls.filter((c) => c.operation === "RevisionAt" || c.operation === "ValidateWorkflow")).toEqual([]);
    });
  });

  it("answers a missing token as config, naming the variables, and health as not ok", async () => {
    fakeEas({});
    const out = await (await connected({})).call("health");
    expect(out.error).toMatchObject({ kind: "config", message: expect.stringContaining("EXPO_TOKEN") });
  });

  it("is healthy when the token's robot sees a project", async () => {
    fakeEas(BASE);
    expect(await (await connected()).call("health")).toEqual({ ok: true, actor: { kind: "Robot", name: "ci-robot (test)" }, accounts: ["acme"], projects: ["@acme/habits"] });
  });
});

describe("wait_for_run", () => {
  /** The server through the guard with a clock that moves only when it waits. */
  const waiting = async () => {
    const clock = { t: 1_790_000_000_000 };
    const deps = { ...buildDeps({ EXPO_TOKEN_FILE: tokenFile() }, { sleep: async () => undefined }), now: () => clock.t, sleep: async (ms: number) => void (clock.t += ms) };
    const server = new McpServer({ name: "eas", version: "test" });
    registerAll(guard(server, { service: "eas", policy: policyFor(deps), log: () => undefined, vocabulary: { asAppError, remedyFor } }), deps);
    const { client } = confirmingClient("test", () => true);
    await connectInMemory(server, client);
    const heard: { progress: number; total?: number | undefined; message?: string | undefined }[] = [];
    const call = async (args: Record<string, unknown>, signal?: AbortSignal) =>
      parse(await client.callTool({ name: "wait_for_run", arguments: args }, { onprogress: (p) => void heard.push(p), ...(signal === undefined ? {} : { signal }) }));
    return { call, heard, clock };
  };

  it("waits for a run to end, telling the client where it stands, and answers as get_workflow_run with the reason", async () => {
    let looks = 0;
    const going = run({ id: "run-1", status: "IN_PROGRESS", jobs: [job({ id: "job-build", key: "build_ios", status: "IN_PROGRESS", type: "BUILD", turtleJobRun: null }), job({ status: "NEW" })] });
    fakeEas({ ...BASE, Run: () => ({ workflowRuns: { byId: (looks += 1) < 3 ? going : run({ id: "run-1" }) } }) }, { [LOG_URL]: SUBMIT_LOG });
    const w = await waiting();
    const out = await w.call({ run: "run-1" });
    expect(out).toMatchObject({ done: true, waited_s: 30, id: "run-1", status: "FAILURE", reason: expect.stringContaining("submit_ios > Prepare credentials") });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(w.heard[0]).toEqual({ progress: 0, total: 600, message: "ios-build.yml IN_PROGRESS, 0 of 2 jobs done, running build_ios" });
    expect(looks).toBe(3);
  });

  it("waits for a build, and answers as get_build once it has errored", async () => {
    let looks = 0;
    fakeEas({ ...BASE, Build: () => ({ builds: { byId: build((looks += 1) < 2 ? { status: "IN_PROGRESS", completedAt: null } : { status: "ERRORED", error: { errorCode: "XCODE_BUILD_ERROR", message: "Xcode failed", docsUrl: null } }) } }) });
    const out = await (await waiting()).call({ build: "build-dev" });
    expect(out).toMatchObject({ done: true, waited_s: 15, id: "build-dev", status: "ERRORED", error: "XCODE_BUILD_ERROR: Xcode failed" });
  });

  it("answers done: false past its minutes, and at once for a run that waits for someone's approval", async () => {
    fakeEas({ ...BASE, Run: (v) => ({ workflowRuns: { byId: run({ id: String(v["runId"]), status: v["runId"] === "run-approve" ? "ACTION_REQUIRED" : "IN_PROGRESS" }) } }) });
    const w = await waiting();
    expect(await w.call({ run: "run-slow", minutes: 1 })).toMatchObject({ done: false, waited_s: 60, status: "IN_PROGRESS", next: expect.stringContaining("again") });
    expect(await w.call({ run: "run-approve" })).toMatchObject({ done: false, waited_s: 0, status: "ACTION_REQUIRED", next: expect.stringContaining("approve") });
    expect((await w.call({})).error).toMatchObject({ kind: "input" });
  });
});
