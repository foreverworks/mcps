/**
 * What the use cases need from EAS, named as operations rather than queries.
 * Answers are EAS's own objects (domain/schema.ts); no URL, GraphQL document
 * or header appears above infra/.
 */
import type { InputFiles } from "@foreverworks/mcp-kit";

import type {
  Platform,
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
  RawWorkflowRun,
  RawWorkflowRunWithJobs,
  WorkflowAtRef,
  WorkflowRead,
} from "../domain/schema.js";
import type { RepublishInput } from "../domain/updates.js";

export type BuildFilter = {
  readonly platform?: Platform;
  readonly status?: string;
  readonly profile?: string;
  readonly appIdentifier?: string;
  readonly gitCommitHash?: string;
  readonly fingerprintHash?: string;
  readonly offset: number;
  readonly limit: number;
};

export type RunFilter = {
  readonly workflowId?: string;
  readonly status?: string;
  readonly gitRef?: string;
  readonly first: number;
  readonly after?: string;
};

export type Page<T> = { readonly items: readonly T[]; readonly nextCursor?: string };

export type IosSubmission = { readonly ascAppIdentifier: string; readonly ascApiKeyId: string; readonly changelog?: string; readonly groups?: readonly string[] };

export type AndroidSubmission = {
  readonly serviceAccountKeyId: string;
  readonly applicationIdentifier?: string;
  readonly track: string;
  readonly releaseStatus?: string;
  readonly rollout?: number;
  readonly changelog?: string;
};

export type EasPort = {
  /** The token's actor and the accounts it belongs to. */
  readonly me: () => Promise<RawMe>;
  /** Every project of one account the token can see. */
  readonly accountApps: (accountName: string) => Promise<readonly RawApp[]>;
  readonly app: (id: string) => Promise<RawApp>;
  readonly builds: (appId: string, filter: BuildFilter) => Promise<readonly RawBuildSummary[]>;
  readonly build: (buildId: string) => Promise<RawBuild>;
  readonly cancelBuild: (buildId: string) => Promise<RawBuildSummary>;
  readonly workflows: (appId: string) => Promise<readonly RawWorkflow[]>;
  readonly runs: (appId: string, filter: RunFilter) => Promise<Page<RawWorkflowRun>>;
  readonly run: (runId: string) => Promise<RawWorkflowRunWithJobs>;
  readonly job: (jobId: string) => Promise<RawWorkflowJob & { readonly workflowRun: { readonly id: string } }>;
  /**
   * The workflow file as it is at a git ref of the project's repository, with
   * the build jobs its YAML declares (EAS's getOrCreate: it records the
   * revision, runs nothing, spends nothing).
   */
  readonly revisionAt: (appId: string, fileName: string, gitRef: string) => Promise<WorkflowAtRef>;
  /** EAS's own check of a workflow file's YAML (what eas workflow:validate asks the server): each problem it names, none when it accepts the file. */
  readonly validateWorkflow: (appId: string, yamlConfig: string) => Promise<readonly string[]>;
  readonly dispatch: (revisionId: string, gitRef: string, inputs: Readonly<Record<string, unknown>> | undefined) => Promise<RawWorkflowRun>;
  readonly cancelRun: (runId: string) => Promise<RawWorkflowRun>;
  readonly submissions: (appId: string, filter: { readonly platform?: Platform; readonly status?: string; readonly offset: number; readonly limit: number }) => Promise<readonly RawSubmission[]>;
  readonly submission: (submissionId: string) => Promise<RawSubmission>;
  readonly submitIos: (appId: string, buildId: string, config: IosSubmission) => Promise<RawSubmission>;
  readonly submitAndroid: (appId: string, buildId: string, config: AndroidSubmission) => Promise<RawSubmission>;
  readonly credentials: (appId: string) => Promise<RawCredentials>;
  /** The App Store Connect API keys an account holds on EAS (no .p8 is ever read). */
  readonly ascKeys: (accountName: string) => Promise<readonly RawAscKey[]>;
  /** The App Store Connect app id of a bundle, as Apple answers it through the key. */
  readonly ascAppIdFor: (ascKeyId: string, bundleIdentifier: string) => Promise<string | undefined>;
  readonly setSubmitKey: (iosCredentialsId: string, ascKeyId: string | null) => Promise<RawIosCredentials>;
  readonly fingerprints: (appId: string, filter: { readonly hashes?: readonly string[]; readonly first: number }) => Promise<readonly RawFingerprint[]>;
  readonly updates: (appId: string, perBranch: number) => Promise<RawUpdates>;
  readonly updateGroup: (group: string) => Promise<readonly RawGroupUpdate[]>;
  /** Publish groups made from existing manifests, in one request: a republish, or a revert's control groups. */
  readonly publishGroups: (inputs: readonly RepublishInput[]) => Promise<readonly RawUpdate[]>;
  /** The newest update on a branch for one platform ("ios", as an update names it) and runtime: what a device there downloads next, unless a rollout holds it back. */
  readonly latestOnBranch: (appId: string, branch: string, platform: string, runtimeVersion: string) => Promise<{ readonly id: string; readonly group: string } | undefined>;
  /** Set one update's rollout percentage; EAS answers the update as it now is. */
  readonly setRollout: (updateId: string, percentage: number) => Promise<{ readonly id: string; readonly platform: string; readonly rolloutPercentage: number | null }>;
};

export type LogPort = {
  /** One log file's text (EAS serves them brotli-compressed from Cloud Storage; the transport decodes). */
  readonly read: (url: string) => Promise<string>;
};

/** The token's actor and every project it can see, across its accounts. */
export type Visible = { readonly me: RawMe; readonly apps: readonly (RawApp & { readonly account: string })[] };

export type Deps = {
  readonly eas: EasPort;
  /** What the token sees, remembered for a few minutes: a project resolved by name costs no request after the first. */
  readonly visible: () => Promise<Visible>;
  readonly logs: LogPort;
  /** A workflow file's jobs and build jobs, read from its YAML the way EAS reads it (infra/workflowYaml.ts). */
  readonly readWorkflow: (yaml: string) => WorkflowRead;
  /** Files a tool takes by path, inside the server's file roots, or as base64 with its sha256 (packages/mcp-kit, inputFile.ts). */
  readonly files: InputFiles;
  readonly now: () => number;
  /** How a poll waits between looks (wait_for_run). */
  readonly sleep: (ms: number) => Promise<unknown>;
  /** The project a call means when it names none and the token sees several (EAS_PROJECT). */
  readonly defaultProject?: string;
  /** The channel names whose updates reach real users (EAS_PRODUCTION_CHANNELS, default `production`). */
  readonly productionChannels: readonly string[];
};
