/**
 * EAS's answers, as the selections in infra/easApi/queries.ts ask for them.
 *
 * Expo publishes no types for its GraphQL API outside eas-cli's generated
 * file, so these are written from the schema (introspection, 2026-10-03). They
 * are checked where it matters: EAS validates every query against its live
 * schema, so a selected field that was renamed or removed fails the whole
 * request as GRAPHQL_VALIDATION_FAILED (reported as `drift`), never as a
 * quietly missing value. What stays a claim is nullability, and the code reads
 * a field it cannot do without through `required`.
 *
 * No secret field is selected anywhere: not a certificate's P12 or password,
 * not a profile's contents, not a keystore or its passwords, not an ASC key's
 * .p8, not an FCM key. An answer cannot leak what it never held.
 */

export type Platform = "IOS" | "ANDROID";

export type RawActor = { readonly __typename: string; readonly displayName: string };

export type RawAccount = {
  readonly id: string;
  readonly name: string;
  readonly apps: readonly RawApp[];
};

export type RawApp = { readonly id: string; readonly fullName: string; readonly slug: string; readonly name: string };

export type RawMe = {
  readonly __typename: string;
  readonly id: string;
  readonly displayName: string;
  readonly accounts: readonly { readonly id: string; readonly name: string }[];
};

export type RawBuildError = { readonly errorCode: string; readonly message: string; readonly docsUrl: string | null };

export type RawBuildSummary = {
  readonly id: string;
  readonly status: string;
  readonly platform: Platform;
  readonly buildProfile: string | null;
  readonly appIdentifier: string | null;
  readonly appVersion: string | null;
  readonly appBuildVersion: string | null;
  readonly distribution: string | null;
  readonly gitCommitHash: string | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
  readonly error: RawBuildError | null;
  readonly fingerprint: { readonly hash: string } | null;
  readonly runtime: { readonly version: string } | null;
  readonly initiatingActor: RawActor | null;
};

export type RawBuild = RawBuildSummary & {
  readonly app: RawApp;
  readonly sdkVersion: string | null;
  readonly isForIosSimulator: boolean;
  readonly gitCommitMessage: string | null;
  readonly message: string | null;
  readonly updatedAt: string;
  readonly expirationDate: string | null;
  readonly artifacts: {
    readonly buildUrl: string | null;
    readonly applicationArchiveUrl: string | null;
    readonly xcodeBuildLogsUrl: string | null;
    readonly buildArtifactsUrl: string | null;
  } | null;
  readonly updateChannel: { readonly name: string } | null;
  readonly logFiles: readonly string[];
  readonly metrics: { readonly buildWaitTime: number | null; readonly buildQueueTime: number | null; readonly buildDuration: number | null } | null;
};

export type RawWorkflow = { readonly id: string; readonly name: string | null; readonly fileName: string; readonly createdAt: string; readonly updatedAt: string };

export type RawRunError = { readonly title: string | null; readonly message: string };

export type RawWorkflowRun = {
  readonly id: string;
  readonly status: string;
  readonly gitCommitHash: string | null;
  readonly gitCommitMessage: string | null;
  readonly requestedGitRef: string | null;
  readonly triggerEventType: string | null;
  readonly triggeringSchedule: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly errors: readonly RawRunError[];
  readonly actor: RawActor | null;
  readonly workflow: { readonly fileName: string; readonly name: string | null };
};

export type RawJobError = { readonly errorCode: string; readonly message: string };

export type RawWorkflowJob = {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly status: string;
  readonly type: string;
  readonly outputs: Readonly<Record<string, unknown>> | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly errors: readonly RawRunError[];
  readonly turtleJobRun: {
    readonly id: string;
    readonly logFileUrls: readonly string[];
    readonly errors: readonly RawJobError[];
    readonly artifacts: readonly {
      readonly name: string;
      readonly filename: string;
      readonly contentType: string | null;
      readonly fileSizeBytes: number | null;
      readonly downloadUrl: string | null;
    }[];
  } | null;
  readonly turtleBuild: {
    readonly id: string;
    readonly status: string;
    readonly platform: Platform;
    readonly buildProfile: string | null;
    readonly error: RawBuildError | null;
    readonly logFiles: readonly string[];
  } | null;
};

export type RawWorkflowRunWithJobs = RawWorkflowRun & { readonly jobs: readonly RawWorkflowJob[] };

/** A workflow file at one commit, as getOrCreateWorkflowRevisionFromGitRef answers. */
export type RawWorkflowRevision = {
  readonly id: string;
  readonly blobSha: string;
  readonly commitSha: string | null;
  readonly yamlConfig: string;
  readonly workflow: { readonly fileName: string; readonly name: string | null };
};

export type RawSubmission = {
  readonly id: string;
  readonly status: string;
  readonly platform: Platform;
  readonly createdAt: string;
  readonly completedAt: string | null;
  readonly error: { readonly errorCode: string | null; readonly message: string | null } | null;
  readonly iosConfig: { readonly ascAppIdentifier: string } | null;
  readonly androidConfig: { readonly track: string; readonly releaseStatus: string | null; readonly rollout: number | null } | null;
  readonly submittedBuild: {
    readonly id: string;
    readonly appIdentifier: string | null;
    readonly appVersion: string | null;
    readonly appBuildVersion: string | null;
    readonly buildProfile: string | null;
  } | null;
  readonly logFiles: readonly string[];
  readonly initiatingActor: RawActor | null;
  readonly workflowJob: {
    readonly id: string;
    readonly key: string;
    readonly workflowRun: { readonly id: string };
    readonly turtleJobRun: { readonly logFileUrls: readonly string[]; readonly errors: readonly RawJobError[] } | null;
  } | null;
};

export type RawAscKey = {
  readonly id: string;
  readonly keyIdentifier: string;
  readonly issuerIdentifier: string | null;
  readonly name: string | null;
};

export type RawIosCredentials = {
  readonly id: string;
  readonly appleTeam: { readonly appleTeamIdentifier: string; readonly appleTeamName: string | null } | null;
  readonly appleAppIdentifier: { readonly bundleIdentifier: string };
  readonly pushKey: { readonly keyIdentifier: string; readonly updatedAt: string } | null;
  readonly appStoreConnectApiKeyForSubmissions: RawAscKey | null;
  readonly iosAppBuildCredentialsList: readonly {
    readonly iosDistributionType: string;
    readonly distributionCertificate: {
      readonly serialNumber: string;
      readonly developerPortalIdentifier: string | null;
      readonly validityNotAfter: string;
    } | null;
    readonly provisioningProfile: {
      readonly developerPortalIdentifier: string | null;
      readonly expiration: string;
      readonly status: string | null;
    } | null;
  }[];
};

export type RawServiceAccountKey = { readonly clientEmail: string; readonly projectIdentifier: string };

export type RawAndroidCredentials = {
  readonly id: string;
  readonly applicationIdentifier: string | null;
  readonly androidFcm: { readonly version: string } | null;
  readonly googleServiceAccountKeyForFcmV1: RawServiceAccountKey | null;
  readonly googleServiceAccountKeyForSubmissions: (RawServiceAccountKey & { readonly id: string }) | null;
  readonly androidAppBuildCredentialsList: readonly {
    readonly name: string;
    readonly isDefault: boolean;
    readonly androidKeystore: {
      readonly type: string;
      readonly keyAlias: string;
      readonly sha1CertificateFingerprint: string | null;
      readonly sha256CertificateFingerprint: string | null;
    } | null;
  }[];
};

export type RawCredentials = {
  readonly ios: readonly RawIosCredentials[];
  readonly android: readonly RawAndroidCredentials[];
};

export type RawFingerprint = {
  readonly hash: string;
  readonly createdAt: string;
  readonly buildCount: number;
  readonly updateCount: number;
  readonly builds: readonly { readonly id: string; readonly platform: Platform; readonly buildProfile: string | null; readonly status: string; readonly appBuildVersion: string | null; readonly createdAt: string }[];
  readonly updates: readonly { readonly group: string; readonly platform: string; readonly branch: string; readonly createdAt: string }[];
};

export type RawUpdate = {
  readonly id: string;
  readonly group: string;
  readonly platform: string;
  readonly message: string | null;
  readonly createdAt: string;
  readonly runtime: { readonly version: string };
  readonly gitCommitHash: string | null;
  readonly rolloutPercentage: number | null;
  readonly isRollBackToEmbedded: boolean;
  readonly actor: RawActor | null;
};

export type RawChannel = { readonly id: string; readonly name: string; readonly branchMapping: string; readonly isPaused: boolean; readonly isProtected: boolean };

export type RawBranch = { readonly id: string; readonly name: string; readonly updates: readonly RawUpdate[] };

export type RawUpdates = { readonly channels: readonly RawChannel[]; readonly branches: readonly RawBranch[] };

/** A workflow file at one commit, with its YAML as EAS read it from the repository. */
export type WorkflowAtRef = {
  readonly revisionId: string;
  readonly fileName: string;
  readonly commitSha: string | null;
  readonly yaml: string;
};

/** One job of a workflow file: its type (or the workflow it `uses`), and the jobs it needs. */
export type WorkflowJobDecl = { readonly key: string; readonly type: string | null; readonly needs?: readonly string[] };

/** A workflow file as infra/workflowYaml.ts reads it, or why nothing could run it. */
export type WorkflowRead = { readonly jobs: readonly WorkflowJobDecl[]; readonly builds: readonly WorkflowBuildJob[] } | { readonly problem: string };

/** The build jobs a workflow file declares, as infra/workflowYaml.ts reads them out of its YAML. */
export type WorkflowBuildJob = {
  readonly key: string;
  readonly platform: string;
  readonly profile: string;
  /** The job has an `if:` (or `needs:` a job that may skip it): whether it builds is decided at run time. */
  readonly conditional: boolean;
};

/** One platform's update in a group, with what a republish copies (updatesByGroup). */
export type RawGroupUpdate = {
  readonly id: string;
  readonly group: string;
  /** The project the group was published in: a republish onto another project's branch is refused. */
  readonly app: { readonly id: string; readonly fullName: string };
  readonly platform: string;
  readonly message: string | null;
  readonly createdAt: string;
  readonly manifestFragment: string;
  readonly isRollBackToEmbedded: boolean;
  readonly runtime: { readonly version: string };
  readonly branch: { readonly id: string; readonly name: string };
  readonly gitCommitHash: string | null;
  readonly isGitWorkingTreeDirty: boolean;
  readonly environment: string | null;
  readonly manifestHostOverride: string | null;
  readonly assetHostOverride: string | null;
  readonly codeSigningInfo: { readonly keyid: string; readonly alg: string } | null;
  /** In a rollout: the share of the branch's devices on its runtime that get it. Null: not in one. */
  readonly rolloutPercentage: number | null;
  /** In a rollout: the update the other devices keep getting (the latest before it), and its group. */
  readonly rolloutControlUpdate: { readonly id: string; readonly group: string } | null;
  readonly fingerprint: {
    readonly hash: string;
    readonly source: { readonly type: string; readonly bucketKey: string; readonly isDebugFingerprint: boolean | null } | null;
  } | null;
};
