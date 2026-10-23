/**
 * The GraphQL documents, one per operation, with the selections domain/schema.ts
 * types. Written against the schema EAS's introspection gave on 2026-10-03 and
 * the queries eas-cli 24.10 sends for the same objects.
 *
 * Never selected, on purpose: certificateP12, certificatePassword,
 * provisioningProfile (the file), keystore, keystorePassword, keyPassword,
 * keyP8, an FCM credential, or any environment variable's value. A field that
 * is not asked for cannot reach a tool result.
 */

const ACTOR = "{ __typename displayName }";

const BUILD_SUMMARY = `
  id status platform buildProfile appIdentifier appVersion appBuildVersion distribution gitCommitHash
  createdAt completedAt
  error { errorCode message docsUrl }
  fingerprint { hash }
  runtime { version }
  initiatingActor ${ACTOR}`;

const BUILD = `${BUILD_SUMMARY}
  app { id fullName slug name }
  sdkVersion isForIosSimulator gitCommitMessage message updatedAt expirationDate
  artifacts { buildUrl applicationArchiveUrl xcodeBuildLogsUrl buildArtifactsUrl }
  updateChannel { name }
  logFiles
  metrics { buildWaitTime buildQueueTime buildDuration }`;

const RUN = `
  id status gitCommitHash gitCommitMessage requestedGitRef triggerEventType triggeringSchedule createdAt updatedAt
  errors { title message }
  actor ${ACTOR}
  workflow { fileName name }`;

const JOB = `
  id key name status type outputs createdAt updatedAt
  errors { title message }
  turtleJobRun { id logFileUrls errors { errorCode message } artifacts { name filename contentType fileSizeBytes downloadUrl } }
  turtleBuild { id status platform buildProfile error { errorCode message docsUrl } logFiles }`;

const SUBMISSION = `
  id status platform createdAt completedAt
  error { errorCode message }
  iosConfig { ascAppIdentifier }
  androidConfig { track releaseStatus rollout }
  submittedBuild { id appIdentifier appVersion appBuildVersion buildProfile }
  logFiles
  initiatingActor ${ACTOR}
  workflowJob { id key workflowRun { id } turtleJobRun { logFileUrls errors { errorCode message } } }`;

const ASC_KEY = "id keyIdentifier issuerIdentifier name";

const IOS_CREDENTIALS = `
  id
  appleTeam { appleTeamIdentifier appleTeamName }
  appleAppIdentifier { bundleIdentifier }
  pushKey { keyIdentifier updatedAt }
  appStoreConnectApiKeyForSubmissions { ${ASC_KEY} }
  iosAppBuildCredentialsList {
    iosDistributionType
    distributionCertificate { serialNumber developerPortalIdentifier validityNotAfter }
    provisioningProfile { developerPortalIdentifier expiration status }
  }`;

const ANDROID_CREDENTIALS = `
  id applicationIdentifier
  androidFcm { version }
  googleServiceAccountKeyForFcmV1 { clientEmail projectIdentifier }
  googleServiceAccountKeyForSubmissions { id clientEmail projectIdentifier }
  androidAppBuildCredentialsList {
    name isDefault
    androidKeystore { type keyAlias sha1CertificateFingerprint sha256CertificateFingerprint }
  }`;

const UPDATE = `
  id group platform message createdAt gitCommitHash rolloutPercentage isRollBackToEmbedded
  runtime { version }
  actor ${ACTOR}`;

export const Q = {
  me: `query Me { meActor { __typename id displayName accounts { id name } } }`,

  accountApps: `query AccountApps($accountName: String!, $after: String) {
    account { byName(accountName: $accountName) {
      appsPaginated(first: 50, after: $after) { pageInfo { hasNextPage endCursor } edges { node { id fullName slug name } } }
    } } }`,

  app: `query App($appId: String!) { app { byId(appId: $appId) { id fullName slug name } } }`,

  builds: `query Builds($appId: String!, $offset: Int!, $limit: Int!, $filter: BuildFilter) {
    app { byId(appId: $appId) { builds(offset: $offset, limit: $limit, filter: $filter) { ${BUILD_SUMMARY} } } } }`,

  build: `query Build($buildId: ID!) { builds { byId(buildId: $buildId) { ${BUILD} } } }`,

  cancelBuild: `mutation CancelBuild($buildId: ID!) { build { cancelBuild(buildId: $buildId) { ${BUILD_SUMMARY} } } }`,

  workflows: `query Workflows($appId: String!) { app { byId(appId: $appId) { workflows { id name fileName createdAt updatedAt } } } }`,

  runs: `query Runs($appId: String!, $first: Int!, $after: String, $filter: AppWorkflowRunFilterInput) {
    app { byId(appId: $appId) {
      workflowRunsPaginated(first: $first, after: $after, filter: $filter) { pageInfo { hasNextPage endCursor } edges { node { ${RUN} } } }
    } } }`,

  run: `query Run($runId: ID!) { workflowRuns { byId(workflowRunId: $runId) { ${RUN} jobs { ${JOB} } } } }`,

  job: `query Job($jobId: ID!) { workflowJobs { byId(workflowJobId: $jobId) { ${JOB} workflowRun { id } } } }`,

  revisionAt: `mutation RevisionAt($appId: ID!, $fileName: String!, $gitRef: String!) {
    workflowRevision { getOrCreateWorkflowRevisionFromGitRef(appId: $appId, fileName: $fileName, gitRef: $gitRef) {
      id blobSha commitSha yamlConfig workflow { fileName name }
    } } }`,

  // A mutation by EAS's schema, and a read in effect: it checks a file's YAML (eas workflow:validate) and stores nothing.
  validateWorkflow: `mutation ValidateWorkflow($appId: ID!, $yamlConfig: String!) {
    workflowRevision { validateWorkflowYamlConfig(appId: $appId, yamlConfig: $yamlConfig) } }`,

  dispatch: `mutation Dispatch($revisionId: ID!, $gitRef: String!, $inputs: JSONObject) {
    workflowRun { createWorkflowRunFromGitRef(workflowRevisionId: $revisionId, gitRef: $gitRef, inputs: $inputs) { ${RUN} } } }`,

  cancelRun: `mutation CancelRun($runId: ID!) { workflowRun { cancelWorkflowRun(workflowRunId: $runId) { ${RUN} } } }`,

  submissions: `query Submissions($appId: String!, $offset: Int!, $limit: Int!, $filter: SubmissionFilter!) {
    app { byId(appId: $appId) { submissions(filter: $filter, offset: $offset, limit: $limit) { ${SUBMISSION} } } } }`,

  submission: `query Submission($submissionId: ID!) { submissions { byId(submissionId: $submissionId) { ${SUBMISSION} } } }`,

  submitIos: `mutation SubmitIos($input: CreateIosSubmissionInput!) { submission { createIosSubmission(input: $input) { submission { ${SUBMISSION} } } } }`,

  submitAndroid: `mutation SubmitAndroid($input: CreateAndroidSubmissionInput!) {
    submission { createAndroidSubmission(input: $input) { submission { ${SUBMISSION} } } } }`,

  credentials: `query Credentials($appId: String!) {
    app { byId(appId: $appId) { iosAppCredentials { ${IOS_CREDENTIALS} } androidAppCredentials { ${ANDROID_CREDENTIALS} } } } }`,

  ascKeys: `query AscKeys($accountName: String!) {
    account { byName(accountName: $accountName) { appStoreConnectApiKeysPaginated(first: 50) { edges { node { ${ASC_KEY} } } } } } }`,

  ascApps: `query AscApps($keyId: ID!, $bundleIdentifier: String!) {
    appStoreConnectApiKey { byId(id: $keyId) { remoteAppStoreConnectApps(bundleIdentifier: $bundleIdentifier) { ascAppIdentifier bundleIdentifier } } } }`,

  setSubmitKey: `mutation SetSubmitKey($id: ID!, $keyId: ID!) {
    iosAppCredentials { setAppStoreConnectApiKeyForSubmissions(id: $id, ascApiKeyId: $keyId) { ${IOS_CREDENTIALS} } } }`,

  clearSubmitKey: `mutation ClearSubmitKey($id: ID!) {
    iosAppCredentials { updateIosAppCredentials(id: $id, iosAppCredentialsInput: { appStoreConnectApiKeyForSubmissionsId: null }) { ${IOS_CREDENTIALS} } } }`,

  fingerprints: `query Fingerprints($appId: String!, $first: Int!, $filter: FingerprintFilterInput) {
    app { byId(appId: $appId) { fingerprintsPaginated(first: $first, filter: $filter) { edges { node {
      hash createdAt buildCount updateCount
      builds(first: 5) { edges { node { id ... on Build { platform buildProfile status appBuildVersion createdAt } } } }
      updates(first: 5) { edges { node { group platform createdAt branch { name } } } }
    } } } } } }`,

  updates: `query Updates($appId: String!, $perBranch: Int!) {
    app { byId(appId: $appId) {
      updateChannels(offset: 0, limit: 50) { id name branchMapping isPaused isProtected }
      updateBranches(offset: 0, limit: 50) { id name updates(offset: 0, limit: $perBranch) { ${UPDATE} } }
    } } }`,

  updateGroup: `query UpdateGroup($group: ID!) { updatesByGroup(group: $group) {
    id group platform message createdAt manifestFragment isRollBackToEmbedded gitCommitHash isGitWorkingTreeDirty environment
    manifestHostOverride assetHostOverride
    app { id fullName }
    runtime { version }
    branch { id name }
    codeSigningInfo { keyid alg }
    rolloutPercentage rolloutControlUpdate { id group }
    fingerprint { hash source { type bucketKey isDebugFingerprint } }
  } }`,

  latestOnBranch: `query LatestOnBranch($appId: String!, $branch: String!, $filter: UpdatesFilter!) {
    app { byId(appId: $appId) { updateBranchByName(name: $branch) { updates(offset: 0, limit: 1, filter: $filter) { id group } } } } }`,

  setRollout: `mutation SetRollout($updateId: ID!, $percentage: Int!) {
    update { setRolloutPercentage(updateId: $updateId, percentage: $percentage) { id platform rolloutPercentage } } }`,

  publishGroup: `mutation PublishGroup($input: [PublishUpdateGroupInput!]!) {
    updateBranch { publishUpdateGroups(publishUpdateGroupsInput: $input) { ${UPDATE} } } }`,
} as const;
