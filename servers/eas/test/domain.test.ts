/**
 * The pure rules: a log read into steps and the line that says why one failed,
 * the credentials audit, the build jobs a workflow file declares, the line the
 * user confirms for a dispatch, and what a republish may and may not do.
 */
import { describe, expect, it } from "vitest";

import { auditAndroid, auditIos, targetsOf } from "../src/domain/credentials.js";
import { failureLine, isFailed, parseLog, stepsOf } from "../src/domain/logs.js";
import { buildIdentity, buildMismatch, groupMismatch, groupSource } from "../src/domain/identity.js";
import { chooseProject } from "../src/domain/projects.js";
import type { RawGroupUpdate } from "../src/domain/schema.js";
import { branchIdsOf, latestPerRuntime, productionChannelsServing, republishPlan } from "../src/domain/updates.js";
import { submissionError } from "../src/domain/views.js";
import { dispatchLine, jobFailure, reasonLine } from "../src/domain/workflows.js";
import { readWorkflow } from "../src/infra/workflowYaml.js";
import { APP, build, credentials, DEV_WORKFLOW, job, KEY, logLine, run, SUBMIT_LOG } from "./helpers.js";

const NOW = Date.parse("2026-01-15T12:00:00Z");

describe("a log", () => {
  it("is grouped into steps in order, with each step's result, and a broken line is counted, not fatal", () => {
    const { lines, unparsed } = parseLog(SUBMIT_LOG);
    expect(unparsed).toBe(1);
    const steps = stepsOf(lines);
    expect(steps.map((s) => [s.name, s.result])).toEqual([
      ["SPIN_UP_BUILDER", "success"],
      ["Download build", "success"],
      ["Prepare credentials", "fail"],
      ["Submit", "skipped"],
    ]);
  });

  it("says why a step failed with what the step printed, not with the builder's restatement", () => {
    const failed = stepsOf(parseLog(SUBMIT_LOG).lines).find(isFailed);
    expect(failed && failureLine(failed)).toBe('eas-cli failed to resolve submission config. Add EXPO_DEBUG: "1" to the job env to see the error.');
  });

  it("falls back to the boilerplate when a failed step printed nothing else", () => {
    const steps = stepsOf(parseLog(logLine("Build", 'Build step "Build" failed', { marker: "end-step", result: "fail" })).lines);
    expect(failureLine(steps[0] ?? { name: "", lines: [] })).toBe('Build step "Build" failed');
  });
});

describe("why a run failed", () => {
  it("is the failed step of the failed job when EAS's own error is the generic one", () => {
    const steps = stepsOf(parseLog(SUBMIT_LOG).lines);
    const failure = jobFailure(job(), steps);
    expect(failure).toEqual({ job: "submit_ios", step: "Prepare credentials", reason: expect.stringContaining("failed to resolve submission config") });
    expect(reasonLine(run(), [failure])).toBe('submit_ios > Prepare credentials: eas-cli failed to resolve submission config. Add EXPO_DEBUG: "1" to the job env to see the error.');
  });

  it("is the job's own error when EAS has one: for an upload, Apple's text", () => {
    const apple = "Increment Build Number: Build number 12 for app version 1.0.0 has already been used.";
    const failure = jobFailure(job({ turtleJobRun: { id: "jr", logFileUrls: [], errors: [{ errorCode: "EAS_UPLOAD_TO_ASC_VERSION_DUPLICATE", message: apple }], artifacts: [] } }), undefined);
    expect(failure).toEqual({ job: "submit_ios", reason: apple, code: "EAS_UPLOAD_TO_ASC_VERSION_DUPLICATE" });
  });

  it("names a job with no log and no error by its status rather than inventing a reason", () => {
    expect(jobFailure(job({ turtleJobRun: null }), undefined).reason).toContain("ended FAILURE");
  });
});

describe("a submission's error", () => {
  it("comes from the workflow job when the submission's own is null", () => {
    expect(
      submissionError({
        id: "s",
        status: "ERRORED",
        platform: "IOS",
        createdAt: "",
        completedAt: null,
        error: null,
        iosConfig: { ascAppIdentifier: "1234567890" },
        androidConfig: null,
        submittedBuild: null,
        logFiles: [],
        initiatingActor: null,
        workflowJob: { id: "j", key: "submit", workflowRun: { id: "r" }, turtleJobRun: { logFileUrls: [], errors: [{ errorCode: "EAS_UPLOAD_TO_ASC_VERSION_DUPLICATE", message: "Build number 12 ... already been used." }] } },
      }),
    ).toBe("EAS_UPLOAD_TO_ASC_VERSION_DUPLICATE: Build number 12 ... already been used.");
  });
});

describe("the credentials audit", () => {
  it("names the missing submit key on the dev bundle, and nothing on the other", () => {
    const [prod, dev] = credentials().ios;
    expect(auditIos("com.example.habits", prod, NOW)).toMatchObject({ ok: true, missing: [], submitKey: { keyId: "ABCDE12345" } });
    const audited = auditIos("com.example.habits.dev", dev, NOW);
    expect(audited.ok).toBe(false);
    expect(audited.missing).toEqual([expect.stringContaining("no App Store Connect API key for submissions")]);
    expect(audited.absent).toEqual([expect.stringContaining("push key")]);
  });

  it("counts down to a certificate's expiry and calls an expired profile missing", () => {
    const [prod] = credentials(KEY).ios;
    const soon = auditIos("com.example.habits", prod, Date.parse("2030-06-10T00:00:00Z"));
    expect(soon.ok).toBe(true);
    expect(soon.expiring).toEqual([expect.stringContaining("certificate expires in 20 days"), expect.stringContaining("profile expires in 20 days")]);
    const late = auditIos("com.example.habits", prod, Date.parse("2030-07-09T00:00:00Z"));
    expect(late.ok).toBe(false);
    expect(late.missing[0]).toContain("expired 8 days ago");
  });

  it("says a bundle or package with no credentials at all cannot be built or submitted", () => {
    expect(auditIos("com.example.new", undefined, NOW).missing[0]).toContain("no iOS credentials");
    expect(auditAndroid("com.example.habits.dev", undefined).missing[0]).toContain("no Android credentials");
  });

  it("covers what is held, what was built and what was asked, and reports an unknown identifier on both platforms", () => {
    const known = [
      { platform: "ios" as const, identifier: "com.example.habits" },
      { platform: "android" as const, identifier: "com.example.habits" },
      { platform: "ios" as const, identifier: "com.example.habits" },
    ];
    expect(targetsOf(known, {})).toEqual([
      { platform: "android", identifier: "com.example.habits" },
      { platform: "ios", identifier: "com.example.habits" },
    ]);
    expect(targetsOf(known, { platform: "ios" })).toEqual([{ platform: "ios", identifier: "com.example.habits" }]);
    expect(targetsOf(known, { identifier: "com.example.new" })).toEqual([
      { platform: "android", identifier: "com.example.new" },
      { platform: "ios", identifier: "com.example.new" },
    ]);
    expect(targetsOf(known, { identifier: "com.example.new", platform: "android" })).toEqual([{ platform: "android", identifier: "com.example.new" }]);
  });
});

/** The build jobs of a file that reads; a test fails loudly on one that does not. */
const buildJobsOf = (yaml: string) => {
  const read = readWorkflow(yaml);
  if ("problem" in read) throw new Error(read.problem);
  return read.builds;
};

describe("a workflow file", () => {
  it("yields its build jobs, with a build behind an if (or a skippable need) marked conditional", () => {
    expect(buildJobsOf(DEV_WORKFLOW)).toEqual([{ key: "build_ios", platform: "ios", profile: "preview", conditional: true }]);
    const plain = "jobs:\n  b:\n    type: build\n    params: { platform: android, profile: production }\n  s:\n    type: submit\n    needs: [b]\n";
    expect(buildJobsOf(plain)).toEqual([{ key: "b", platform: "android", profile: "production", conditional: false }]);
  });

  it("lists every job with its type and needs, a reusable one by the workflow it uses", () => {
    const read = readWorkflow(DEV_WORKFLOW);
    expect("jobs" in read && read.jobs.slice(0, 2)).toEqual([
      { key: "fingerprint", type: "fingerprint" },
      { key: "get_ios_build", type: "get-build", needs: ["fingerprint"] },
    ]);
    const reused = readWorkflow("jobs:\n  shared:\n    uses: ./.eas/workflows/common.yml\n");
    expect("jobs" in reused && reused.jobs).toEqual([{ key: "shared", type: "uses ./.eas/workflows/common.yml" }]);
  });

  it("reads merge keys the way EAS does, so a build made from an anchor is still a build", () => {
    const anchored = "x-ios: &ios\n  type: build\n  params: { platform: ios, profile: preview }\njobs:\n  build_ios:\n    <<: *ios\n";
    expect(buildJobsOf(anchored)).toEqual([{ key: "build_ios", platform: "ios", profile: "preview", conditional: false }]);
  });

  it("says why when nothing could run it: YAML that does not parse, an empty file, no jobs", () => {
    expect(readWorkflow("jobs: [unclosed")).toEqual({ problem: expect.stringMatching(/^the file is not valid YAML: /) as unknown as string });
    expect(readWorkflow("# only a comment\n")).toEqual({ problem: "the file is empty or holds only comments" });
    expect(readWorkflow("name: x\non: {}\n")).toEqual({ problem: "the file has no jobs: mapping" });
    expect(readWorkflow("- a\n- b\n")).toEqual({ problem: "the file is not a mapping of keys (name, on, jobs ...)" });
  });
});

describe("the line a user confirms for a dispatch", () => {
  it("names the project, the file, the ref and each build with its platform and profile, and the spend", () => {
    const line = dispatchLine({ project: APP.fullName, fileName: "ios-build.yml", gitRef: "main", builds: buildJobsOf(DEV_WORKFLOW) });
    expect(line).toBe(
      "Run EAS workflow ios-build.yml of @acme/habits at main: builds ios preview (if its condition holds); may spend EAS build credits.",
    );
    expect(line.length).toBeLessThanOrEqual(300);
    expect(dispatchLine({ project: APP.fullName, fileName: "a.yml", gitRef: "main", builds: [{ key: "b", platform: "android", profile: "production", conditional: false }] })).toContain(
      "spends EAS build credits",
    );
    expect(dispatchLine({ project: APP.fullName, fileName: "a.yml", gitRef: "main", builds: [] })).toContain("spends no EAS build credits");
  });
});

describe("updates", () => {
  const channel = (name: string, branchId: string) => ({ id: name, name, isPaused: false, isProtected: false, branchMapping: JSON.stringify({ version: 0, data: [{ branchId, branchMappingLogic: "true" }] }) });

  it("map a channel to its branches and know which branches production serves", () => {
    expect(branchIdsOf(channel("production", "b1"))).toEqual(["b1"]);
    expect(branchIdsOf({ ...channel("x", "b"), branchMapping: "not json" })).toEqual([]);
    expect(productionChannelsServing("b1", [channel("production", "b1"), channel("preview", "b2")], ["production"])).toEqual(["production"]);
    expect(productionChannelsServing("b2", [channel("production", "b1"), channel("preview", "b2")], ["production"])).toEqual([]);
  });

  it("keep the newest update per platform and runtime", () => {
    const u = (id: string, platform: string, runtime: string) => ({
      id,
      group: id,
      platform,
      message: null,
      createdAt: id,
      runtime: { version: runtime },
      gitCommitHash: null,
      rolloutPercentage: null,
      isRollBackToEmbedded: false,
      actor: null,
    });
    const latest = latestPerRuntime({ id: "b", name: "production", updates: [u("3", "ios", "r2"), u("2", "ios", "r2"), u("1", "ios", "r1"), u("0", "android", "r2")] });
    expect(latest.map((x) => x.group)).toEqual(["3", "1", "0"]);
  });

  const update = (over: Partial<RawGroupUpdate> = {}): RawGroupUpdate => ({
    id: "u1",
    group: "g1",
    app: { id: APP.id, fullName: APP.fullName },
    platform: "ios",
    message: "feat: x\n\nbody",
    createdAt: "2026-10-01T09:00:00.000Z",
    manifestFragment: JSON.stringify({ launchAsset: { bundleKey: "k" } }),
    isRollBackToEmbedded: false,
    runtime: { version: "r1" },
    branch: { id: "b-prev", name: "preview" },
    gitCommitHash: "abc",
    isGitWorkingTreeDirty: false,
    environment: "production",
    manifestHostOverride: null,
    assetHostOverride: null,
    codeSigningInfo: null,
    rolloutPercentage: null,
    rolloutControlUpdate: null,
    fingerprint: { hash: "fp", source: { type: "GCS", bucketKey: "key", isDebugFingerprint: false } },
    ...over,
  });

  it("republish a group's own manifests onto the target branch, uploading nothing", () => {
    const plan = republishPlan([update(), update({ id: "u2", platform: "android" })], { id: "b-prod", name: "production" }, {});
    expect("input" in plan && plan.input).toMatchObject({
      branchId: "b-prod",
      runtimeVersion: "r1",
      message: "Republish of group g1: feat: x",
      updateInfoGroup: { ios: { launchAsset: { bundleKey: "k" } }, android: { launchAsset: { bundleKey: "k" } } },
      fingerprintInfoGroup: { ios: { fingerprintHash: "fp" } },
      awaitingCodeSigningInfo: false,
    });
  });

  it("refuse a signed group, a group in a rollout, and a platform the group lacks", () => {
    const target = { id: "b", name: "production" };
    expect(republishPlan([update({ codeSigningInfo: { keyid: "main", alg: "rsa-v1_5-sha256" } })], target, {})).toEqual({ problem: expect.stringContaining("code-signed") });
    expect(republishPlan([update({ rolloutPercentage: 10, rolloutControlUpdate: { id: "x", group: "g0" } })], target, {})).toEqual({ problem: expect.stringContaining("rollout") });
    expect(republishPlan([update()], target, { platform: "android" })).toEqual({ problem: "the group has no android update" });
  });

  it("refuse a group of another project, and one from another commit than expected, by prefix and in any case", () => {
    const habits = { id: APP.id, fullName: APP.fullName };
    expect(groupMismatch([update()], habits, undefined)).toBeUndefined();
    expect(groupMismatch([update({ gitCommitHash: "ABCDEF0123" })], habits, "abcdef0")).toBeUndefined();
    expect(groupMismatch([update(), update({ app: { id: "x", fullName: "@acme/other" } })], habits, undefined)).toMatch(/belongs to @acme\/other, not @acme\/habits/);
    expect(groupMismatch([update({ gitCommitHash: "abcdef0123" })], habits, "abcdef1")).toMatch(/from commit abcdef0123, not abcdef1/);
    expect(groupMismatch([update({ gitCommitHash: null })], habits, "abcdef1")).toMatch(/\(none recorded\)/);
    expect(groupSource([])).toBeUndefined();
  });
});

describe("a build to submit", () => {
  it("is refused when its version or build number is not what the caller expected", () => {
    expect(buildMismatch(build(), {})).toBeUndefined();
    expect(buildMismatch(build(), { version: "1.0.0", buildNumber: "12" })).toBeUndefined();
    expect(buildMismatch(build({ appBuildVersion: null }), { buildNumber: "12" })).toMatch(/build number \(none\), not 12/);
    expect(buildIdentity(build())).toEqual({
      id: "build-dev",
      platform: "IOS",
      profile: "preview",
      appIdentifier: "com.example.habits.dev",
      appVersion: "1.0.0",
      buildNumber: "12",
      commit: "1111111111111111111111111111111111111111",
      commitMessage: "chore: bump version",
      completedAt: "2026-01-15T10:09:00.000Z",
    });
  });
});

describe("a project named by a caller", () => {
  const other = { id: "other", fullName: "@acme/other", slug: "other", name: "Other" };

  it("is found by id, full name, full name without the @, or a slug only one project has", () => {
    for (const name of [APP.id, "@acme/habits", "acme/habits", "habits"]) expect(chooseProject(name, [APP, other])).toEqual({ app: APP });
  });

  it("defaults to the only project, and asks for a name when there are several", () => {
    expect(chooseProject(undefined, [APP])).toEqual({ app: APP });
    expect(chooseProject(undefined, [APP, other])).toEqual({ problem: expect.stringContaining("name a project") });
    expect(chooseProject("nope", [APP])).toEqual({ problem: expect.stringContaining('no visible project is "nope"') });
  });
});
