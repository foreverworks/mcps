import { compact } from "@foreverworks/mcp-kit";

import type { EasPort, Page } from "../app/ports.js";
import { asAppError, required } from "../domain/errors.js";
import type {
  RawApp,
  RawAscKey,
  RawBuild,
  RawBuildSummary,
  RawCredentials,
  RawFingerprint,
  RawGroupUpdate,
  RawIosCredentials,
  RawMe,
  RawSubmission,
  RawUpdate,
  RawUpdates,
  RawWorkflow,
  RawWorkflowJob,
  RawWorkflowRevision,
  RawWorkflowRun,
  RawWorkflowRunWithJobs,
  Platform,
} from "../domain/schema.js";
import { Q } from "./easApi/queries.js";
import type { Graphql } from "./graphql.js";

/**
 * Every operation the use cases name, as one GraphQL request each (two for a
 * paginated account). The only module that knows the documents and the
 * envelopes they come back in; the use cases get EAS's objects.
 */

type Edges<T> = { readonly edges: readonly { readonly node: T }[]; readonly pageInfo?: { readonly hasNextPage: boolean; readonly endCursor: string | null } };

const nodes = <T>(connection: Edges<T>): readonly T[] => connection.edges.map((e) => e.node);

type AppOf<T> = { readonly app: { readonly byId: T } };

export const makeEasApi = (gql: Graphql): EasPort => {
  const appQuery = async <T>(document: string, variables: Readonly<Record<string, unknown>>): Promise<T> =>
    (await gql.query<AppOf<T>>(document, variables)).app.byId;

  return {
    me: async () => required((await gql.query<{ readonly meActor: RawMe | null }>(Q.me)).meActor, "actor for this token"),

    accountApps: async (accountName) => {
      const apps: RawApp[] = [];
      let after: string | null = null;
      // A guard, not a limit anyone should meet: 20 pages of 50.
      for (let page = 0; page < 20; page += 1) {
        const data: { account: { byName: { appsPaginated: Edges<RawApp> } } } = await gql.query(Q.accountApps, compact({ accountName, after: after ?? undefined }));
        const connection = data.account.byName.appsPaginated;
        apps.push(...nodes(connection));
        if (connection.pageInfo?.hasNextPage !== true || !connection.pageInfo.endCursor) break;
        after = connection.pageInfo.endCursor;
      }
      return apps;
    },

    app: (appId) => appQuery<RawApp>(Q.app, { appId }),

    builds: async (appId, f) =>
      (
        await appQuery<{ readonly builds: readonly RawBuildSummary[] }>(Q.builds, {
          appId,
          offset: f.offset,
          limit: f.limit,
          filter: compact({
            platform: f.platform,
            status: f.status,
            buildProfile: f.profile,
            appIdentifier: f.appIdentifier,
            gitCommitHash: f.gitCommitHash,
            fingerprintHash: f.fingerprintHash,
          }),
        })
      ).builds,

    build: async (buildId) => (await gql.query<{ readonly builds: { readonly byId: RawBuild } }>(Q.build, { buildId })).builds.byId,

    cancelBuild: async (buildId) => (await gql.mutate<{ readonly build: { readonly cancelBuild: RawBuildSummary } }>(Q.cancelBuild, { buildId })).build.cancelBuild,

    workflows: async (appId) => (await appQuery<{ readonly workflows: readonly RawWorkflow[] }>(Q.workflows, { appId })).workflows,

    runs: async (appId, f): Promise<Page<RawWorkflowRun>> => {
      const filter = compact({ workflowId: f.workflowId, status: f.status, requestedGitRef: f.gitRef });
      const { workflowRunsPaginated: connection } = await appQuery<{ readonly workflowRunsPaginated: Edges<RawWorkflowRun> }>(
        Q.runs,
        compact({ appId, first: f.first, after: f.after, filter: Object.keys(filter).length === 0 ? undefined : filter }),
      );
      const next = connection.pageInfo?.hasNextPage === true ? (connection.pageInfo.endCursor ?? undefined) : undefined;
      return { items: nodes(connection), ...(next === undefined ? {} : { nextCursor: next }) };
    },

    run: async (runId) => (await gql.query<{ readonly workflowRuns: { readonly byId: RawWorkflowRunWithJobs } }>(Q.run, { runId })).workflowRuns.byId,

    job: async (jobId) =>
      (await gql.query<{ readonly workflowJobs: { readonly byId: RawWorkflowJob & { readonly workflowRun: { readonly id: string } } } }>(Q.job, { jobId }))
        .workflowJobs.byId,

    revisionAt: async (appId, fileName, gitRef) => {
      const revision = (
        await gql.mutate<{ readonly workflowRevision: { readonly getOrCreateWorkflowRevisionFromGitRef: RawWorkflowRevision } }>(Q.revisionAt, {
          appId,
          fileName,
          gitRef,
        })
      ).workflowRevision.getOrCreateWorkflowRevisionFromGitRef;
      return { revisionId: revision.id, fileName: revision.workflow.fileName, commitSha: revision.commitSha, yaml: revision.yamlConfig };
    },

    validateWorkflow: async (appId, yamlConfig) => {
      try {
        await gql.mutate<{ readonly workflowRevision: { readonly validateWorkflowYamlConfig: boolean } }>(Q.validateWorkflow, { appId, yamlConfig });
        return [];
      } catch (thrown) {
        // EAS answers a file it refuses as a VALIDATION_ERROR naming each problem: that is the answer, not a failure.
        const error = asAppError(thrown);
        if (error?.kind === "input" && error.code === "VALIDATION_ERROR") return error.issues ?? [error.message];
        throw thrown;
      }
    },

    dispatch: async (revisionId, gitRef, inputs) =>
      (
        await gql.mutate<{ readonly workflowRun: { readonly createWorkflowRunFromGitRef: RawWorkflowRun } }>(
          Q.dispatch,
          compact({ revisionId, gitRef, inputs }),
        )
      ).workflowRun.createWorkflowRunFromGitRef,

    cancelRun: async (runId) => (await gql.mutate<{ readonly workflowRun: { readonly cancelWorkflowRun: RawWorkflowRun } }>(Q.cancelRun, { runId })).workflowRun.cancelWorkflowRun,

    submissions: async (appId, f) =>
      (
        await appQuery<{ readonly submissions: readonly RawSubmission[] }>(Q.submissions, {
          appId,
          offset: f.offset,
          limit: f.limit,
          filter: compact({ platform: f.platform, status: f.status }),
        })
      ).submissions,

    submission: async (submissionId) => (await gql.query<{ readonly submissions: { readonly byId: RawSubmission } }>(Q.submission, { submissionId })).submissions.byId,

    submitIos: async (appId, buildId, c) =>
      (
        await gql.mutate<{ readonly submission: { readonly createIosSubmission: { readonly submission: RawSubmission } } }>(Q.submitIos, {
          input: { appId, submittedBuildId: buildId, config: compact({ ascAppIdentifier: c.ascAppIdentifier, ascApiKeyId: c.ascApiKeyId, changelog: c.changelog, groups: c.groups }) },
        })
      ).submission.createIosSubmission.submission,

    submitAndroid: async (appId, buildId, c) =>
      (
        await gql.mutate<{ readonly submission: { readonly createAndroidSubmission: { readonly submission: RawSubmission } } }>(Q.submitAndroid, {
          input: {
            appId,
            submittedBuildId: buildId,
            config: compact({
              googleServiceAccountKeyId: c.serviceAccountKeyId,
              applicationIdentifier: c.applicationIdentifier,
              track: c.track,
              releaseStatus: c.releaseStatus,
              rollout: c.rollout,
              changelog: c.changelog,
            }),
          },
        })
      ).submission.createAndroidSubmission.submission,

    credentials: async (appId): Promise<RawCredentials> => {
      const app = await appQuery<{ readonly iosAppCredentials: RawCredentials["ios"]; readonly androidAppCredentials: RawCredentials["android"] }>(Q.credentials, { appId });
      return { ios: app.iosAppCredentials, android: app.androidAppCredentials };
    },

    ascKeys: async (accountName) =>
      nodes(
        (await gql.query<{ readonly account: { readonly byName: { readonly appStoreConnectApiKeysPaginated: Edges<RawAscKey> } } }>(Q.ascKeys, { accountName })).account
          .byName.appStoreConnectApiKeysPaginated,
      ),

    ascAppIdFor: async (keyId, bundleIdentifier) => {
      const apps = (
        await gql.query<{ readonly appStoreConnectApiKey: { readonly byId: { readonly remoteAppStoreConnectApps: readonly { readonly ascAppIdentifier: string; readonly bundleIdentifier: string }[] } } }>(
          Q.ascApps,
          { keyId, bundleIdentifier },
        )
      ).appStoreConnectApiKey.byId.remoteAppStoreConnectApps;
      return apps.find((a) => a.bundleIdentifier === bundleIdentifier)?.ascAppIdentifier;
    },

    setSubmitKey: async (id, keyId): Promise<RawIosCredentials> =>
      keyId === null
        ? (await gql.mutate<{ readonly iosAppCredentials: { readonly updateIosAppCredentials: RawIosCredentials } }>(Q.clearSubmitKey, { id })).iosAppCredentials
            .updateIosAppCredentials
        : (await gql.mutate<{ readonly iosAppCredentials: { readonly setAppStoreConnectApiKeyForSubmissions: RawIosCredentials } }>(Q.setSubmitKey, { id, keyId }))
            .iosAppCredentials.setAppStoreConnectApiKeyForSubmissions,

    fingerprints: async (appId, f): Promise<readonly RawFingerprint[]> => {
      type Wire = Omit<RawFingerprint, "builds" | "updates"> & {
        readonly builds: Edges<{ readonly id: string; readonly platform?: Platform; readonly buildProfile?: string | null; readonly status?: string; readonly appBuildVersion?: string | null; readonly createdAt?: string }>;
        readonly updates: Edges<{ readonly group: string; readonly platform: string; readonly createdAt: string; readonly branch: { readonly name: string } }>;
      };
      const connection = (
        await appQuery<{ readonly fingerprintsPaginated: Edges<Wire> }>(
          Q.fingerprints,
          compact({ appId, first: f.first, filter: f.hashes === undefined ? undefined : { hashes: f.hashes } }),
        )
      ).fingerprintsPaginated;
      return nodes(connection).map((fp) => ({
        hash: fp.hash,
        createdAt: fp.createdAt,
        buildCount: fp.buildCount,
        updateCount: fp.updateCount,
        builds: nodes(fp.builds).map((b) => ({
          id: b.id,
          platform: required(b.platform, "platform of a fingerprint's build"),
          buildProfile: b.buildProfile ?? null,
          status: b.status ?? "",
          appBuildVersion: b.appBuildVersion ?? null,
          createdAt: b.createdAt ?? "",
        })),
        updates: nodes(fp.updates).map((u) => ({ group: u.group, platform: u.platform, branch: u.branch.name, createdAt: u.createdAt })),
      }));
    },

    updates: async (appId, perBranch): Promise<RawUpdates> => {
      const app = await appQuery<{ readonly updateChannels: RawUpdates["channels"]; readonly updateBranches: RawUpdates["branches"] }>(Q.updates, { appId, perBranch });
      return { channels: app.updateChannels, branches: app.updateBranches };
    },

    updateGroup: async (group) => (await gql.query<{ readonly updatesByGroup: readonly RawGroupUpdate[] }>(Q.updateGroup, { group })).updatesByGroup,

    publishGroups: async (inputs) =>
      (await gql.mutate<{ readonly updateBranch: { readonly publishUpdateGroups: readonly RawUpdate[] } }>(Q.publishGroup, { input: inputs })).updateBranch.publishUpdateGroups,

    latestOnBranch: async (appId, branch, platform, runtimeVersion) => {
      type Latest = { readonly updateBranchByName: { readonly updates: readonly { readonly id: string; readonly group: string }[] } | null };
      const found = await appQuery<Latest>(Q.latestOnBranch, { appId, branch, filter: { platform: platform.toUpperCase(), runtimeVersions: [runtimeVersion] } });
      return found.updateBranchByName?.updates[0];
    },

    setRollout: async (updateId, percentage) =>
      (
        await gql.mutate<{ readonly update: { readonly setRolloutPercentage: { readonly id: string; readonly platform: string; readonly rolloutPercentage: number | null } } }>(Q.setRollout, {
          updateId,
          percentage,
        })
      ).update.setRolloutPercentage,
  };
};
