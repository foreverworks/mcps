/**
 * The adapter against a stubbed fetch: what each EAS answer becomes, which
 * requests repeat, and where the token goes (and where it does not).
 */
import { writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildDeps } from "../src/composition.js";
import { APP_ID, errorOf, fakeEas, gqlError, json, LOG_URL, ME, SUBMIT_LOG, tokenFile } from "./helpers.js";

const noWait = { sleep: async () => undefined };

describe("the EAS adapter", () => {
  it("sends the token as a bearer token to the GraphQL endpoint, and never to a log host", async () => {
    const calls = fakeEas({ Me: () => ME }, { [LOG_URL]: SUBMIT_LOG });
    const deps = buildDeps({ EXPO_TOKEN_FILE: tokenFile("tok-A") }, noWait);
    await deps.eas.me();
    await deps.logs.read(LOG_URL);
    expect(calls[0]).toMatchObject({ operation: "Me", authorization: "Bearer tok-A" });
    expect(calls[1]).toEqual({ url: LOG_URL });
  });

  it("reads EXPO_TOKEN when no file is named, and fails as config before sending anything without either", async () => {
    const calls = fakeEas({ Me: () => ME });
    await buildDeps({ EXPO_TOKEN: "tok-env" }, noWait).eas.me();
    expect(calls[0]?.authorization).toBe("Bearer tok-env");
    const error = await errorOf(() => buildDeps({}, noWait).eas.me());
    expect(error).toMatchObject({ kind: "config", message: expect.stringContaining("EXPO_TOKEN_FILE") });
    expect(calls).toHaveLength(1);
  });

  it("re-reads the token file after a 401, so a replaced token works without a restart", async () => {
    const file = tokenFile("old");
    let seen = 0;
    const calls = fakeEas({
      Me: () => {
        seen += 1;
        if (seen === 1) {
          writeFileSync(file, "new\n");
          return json({ errors: [{ code: "AUTHENTICATION_ERROR", message: "The bearer token is invalid." }] }, 401);
        }
        return ME;
      },
    });
    await buildDeps({ EXPO_TOKEN_FILE: file }, noWait).eas.me();
    expect(calls.map((c) => c.authorization)).toEqual(["Bearer old", "Bearer new"]);
  });

  it("calls a token EAS keeps refusing auth", async () => {
    fakeEas({ Me: () => json({ errors: [{ code: "AUTHENTICATION_ERROR", message: "The bearer token is invalid." }] }, 401) });
    expect(await errorOf(() => buildDeps({ EXPO_TOKEN: "t" }, noWait).eas.me())).toMatchObject({ kind: "auth", message: "The bearer token is invalid." });
  });

  it("turns EAS's error codes into kinds: not found, invalid input, refused, drift", async () => {
    const deps = (answer: Response) => {
      fakeEas({ App: () => answer, Build: () => answer });
      return buildDeps({ EXPO_TOKEN: "t" }, noWait);
    };
    expect(await errorOf(() => deps(gqlError("Experience with id 'x' does not exist.", { errorCode: "EXPERIENCE_NOT_FOUND", errorType: "USER" })).eas.app(APP_ID))).toMatchObject({
      kind: "not_found",
      code: "EXPERIENCE_NOT_FOUND",
    });
    expect(await errorOf(() => deps(gqlError("Invalid UUID buildId", { errorCode: "VALIDATION_ERROR", errorType: "USER" })).eas.build("x"))).toMatchObject({ kind: "input" });
    expect(await errorOf(() => deps(gqlError("Build already finished", { errorCode: "BUILD_ALREADY_FINISHED", errorType: "USER" })).eas.build("x"))).toMatchObject({
      kind: "refused",
      message: "Build already finished",
    });
    expect(await errorOf(() => deps(gqlError("Cannot query field", { code: "GRAPHQL_VALIDATION_FAILED", errorType: "SYSTEM" }, 400)).eas.build("x"))).toMatchObject({ kind: "drift" });
    expect(await errorOf(() => deps(gqlError("Not authorized", { errorCode: "UNAUTHORIZED_ERROR", errorType: "USER" })).eas.build("x"))).toMatchObject({ kind: "forbidden" });
  });

  it("repeats a query after a 5xx, and never repeats a mutation after one: it is outcome_unknown", async () => {
    let builds = 0;
    let cancels = 0;
    fakeEas({
      Build: () => (++builds === 1 ? new Response("bad gateway", { status: 502 }) : { builds: { byId: { id: "b" } } }),
      CancelBuild: () => {
        cancels += 1;
        return new Response("bad gateway", { status: 502 });
      },
    });
    const deps = buildDeps({ EXPO_TOKEN: "t" }, noWait);
    await expect(deps.eas.build("b")).resolves.toMatchObject({ id: "b" });
    expect(builds).toBe(2);
    expect(await errorOf(() => deps.eas.cancelBuild("b"))).toMatchObject({ kind: "outcome_unknown" });
    expect(cancels).toBe(1);
  });

  it("treats a transient error on a mutation as outcome_unknown and on a query as api", async () => {
    const transient = () => gqlError("try again", { errorCode: "INTERNAL", errorType: "SYSTEM", isTransient: true });
    fakeEas({ Build: transient, CancelBuild: transient });
    const deps = buildDeps({ EXPO_TOKEN: "t" }, noWait);
    expect(await errorOf(() => deps.eas.build("b"))).toMatchObject({ kind: "api" });
    expect(await errorOf(() => deps.eas.cancelBuild("b"))).toMatchObject({ kind: "outcome_unknown" });
  });

  it("reads a workflow file at a ref as EAS has it, and dispatches at the ref as given", async () => {
    const calls = fakeEas({
      RevisionAt: () => ({
        workflowRevision: {
          getOrCreateWorkflowRevisionFromGitRef: {
            id: "rev-1",
            blobSha: "b10b0001",
            commitSha: "c0ffee01",
            yamlConfig: "jobs:\n  b:\n    type: build\n    params: { platform: ios, profile: production }\n",
            workflow: { fileName: "ios-build.yml", name: "iOS build" },
          },
        },
      }),
      Dispatch: () => ({ workflowRun: { createWorkflowRunFromGitRef: { id: "run-new", status: "NEW", workflow: { fileName: "ios-build.yml" } } } }),
    });
    const deps = buildDeps({ EXPO_TOKEN: "t" }, noWait);
    expect(await deps.eas.revisionAt(APP_ID, "ios-build.yml", "refs/tags/v1.0.0")).toEqual({
      revisionId: "rev-1",
      fileName: "ios-build.yml",
      commitSha: "c0ffee01",
      yaml: "jobs:\n  b:\n    type: build\n    params: { platform: ios, profile: production }\n",
    });
    await deps.eas.dispatch("rev-1", "refs/tags/v1.0.0", undefined);
    expect(calls.map((c) => [c.operation, c.variables])).toEqual([
      ["RevisionAt", { appId: APP_ID, fileName: "ios-build.yml", gitRef: "refs/tags/v1.0.0" }],
      ["Dispatch", { revisionId: "rev-1", gitRef: "refs/tags/v1.0.0" }],
    ]);
  });
});
