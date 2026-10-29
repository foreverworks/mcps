/**
 * The parts every server in this repo had copied, and the rules every server
 * must follow the same way.
 *
 * What belongs here is machinery with no opinion about any one API: the failure
 * tag, the tool envelope, a backoff schedule, calendar and exact decimal
 * arithmetic, an invoice's total by EN 16931's rounding, the two rules for a
 * JSON file several processes share (and any file written whole), where a server's files are and how its app.json is
 * read without quoting it, a file a tool takes as input (byte-exact, by path
 * or by checked base64), the shell modes' verdict line, the transport, and
 * the guard every call passes (policy, annotations, the ceiling, an optional
 * confirmation for money, the audit line).
 * What does NOT belong here is anything that names an endpoint, a field or a
 * remedy. Those are the parts that make a server worth reading, and a shared
 * copy of them would be wrong for four servers out of five.
 */
export { makeErrorKit, makeRequired, type ErrorKit } from "./errors.js";
export { asFailure, failure, makeHandled, outcomeOf, type EnvelopeVocabulary, type ToolResult } from "./envelope.js";
export { once } from "./once.js";
export { cnp, iban, romanianCif, type Checked } from "./identifiers.js";
export { packageIdentity, productIcons, type PackageIdentity } from "./packageIdentity.js";
export { packageVersion } from "./packageVersion.js";
export { compact, type Compact } from "./compact.js";
export { backoffMs, retryAfterSeconds, type Backoff } from "./backoff.js";
export { isIsoDate, addDays, daysBetween, weekdayOf } from "./dates.js";
export {
  add,
  compare,
  DECIMAL_TEXT,
  divideRounded,
  exactNumberText,
  formatDecimal,
  mul,
  mulDiv,
  parseDecimal,
  percentOf,
  percentWithin,
  placesOf,
  round,
  sub,
  sum,
  toDecimal,
  ZERO,
  type Decimal,
  type Rounding,
} from "./decimal.js";
export { AMOUNT_SCALE, asAmount, computable, documentTotal, lineAmount, reversalTotal, type DocumentTotal, type RateTotal, type TaxedLine } from "./invoiceTotals.js";
export { readJsonFile, withFileLock, writeJsonFile, type JsonFileOptions, type LockOptions } from "./jsonFile.js";
export { writeFileAtomic } from "./files.js";
export { run, type RunOptions, type RunResult } from "./run.js";
export { csvOf } from "./csv.js";
export { envPath, stateDirOf, timeZoneOf, unsetPath } from "./env.js";
export { readConfigFile } from "./configFile.js";
export { readSecret, type SecretSource } from "./secret.js";
export { issuesText, type Issues } from "./issues.js";
export {
  asksProgress,
  bearerMatches,
  checkPolicy,
  clientFor,
  listenFrom,
  loadTokens,
  MCP_PATH,
  serve,
  type Listen,
  type Served,
  type ServeOptions,
  type ClientTokenFiles,
  type ClientTokens,
} from "./serve.js";
export type { Product } from "./serve/icons.js";
export { idempotentWrites, isIdempotent, mergePolicies, needsPerson, summaryFrom, unclassified, type Access, type Confirmation, type ConfirmedRule, type ToolArgs, type ToolPolicy, type ToolRule } from "./policy.js";
export { ALL_TOOLSETS, toolsetPolicy, toolsetsFrom, type Toolsets } from "./toolsets.js";
export { ACCESS_META, annotationsFor, auditText, guard, registeredNames, REQUIRES_USER_META, requestContext, type AuditLine, type GuardOptions, type ServerVocabulary } from "./serve/guard.js";
export {
  ACCESS_ORDER,
  CONFIRM_MODES,
  DEFAULT_SETTINGS,
  describeSettings,
  guardSettingsFrom,
  within,
  type Confirm,
  type GuardSettings,
} from "./serve/confirm.js";
export { asGuardError, failGuard, guardRemedy, type GuardError } from "./guardErrors.js";
export { DEFAULT_LIMITS, egressFrom, hostAllowed, limitsFrom, take, type Bucket, type Limits } from "./serve/limits.js";
export type { DeepReadonly, OutputOf, Wire } from "./readonly.js";
export { makeHttp, NOT_JSON, OUTCOME_UNKNOWN, redactCredentials, type HttpAuth, type HttpFailure, type HttpOptions, type HttpPolicy, type HttpRequest, type Query, type RequestSpec, type Sleep } from "./http.js";
export { epochNow, fileTokenStore, makeTokenSource, memoryTokenStore, type Minted, type TokenSource, type TokenSourceOptions, type TokenStore } from "./tokens.js";
export { mapWithConcurrency, memoize } from "./concurrency.js";
export { makePacer, makeThrottle, type Pace, type PacerClock, type Throttle, type ThrottleClock } from "./pacer.js";
export { inSeries, makeFailureVerdict, OK, PERMANENT, TRANSIENT, verdictOf, worst, type Verdict, type VerdictVocabulary } from "./verdict.js";
export {
  authorizeUrl,
  bearer,
  makeOAuthClient,
  mintedFrom,
  newPkce,
  newState,
  parseRedirect,
  pkceFrom,
  type AuthorizeRequest,
  type BearerTokens,
  type Granted,
  type OAuthClient,
  type OAuthClientOptions,
  type OAuthFailure,
  type Pkce,
  type Random,
  type Redirect,
} from "./oauth.js";
export { mimeTypeOf, resolveSaveDir, resourceLinkTo, type ResourceLink, type SaveDir } from "./outbox.js";
export { collectHandedBack, noteHandedBack, saveToOutbox, type SavedFile } from "./handedBack.js";
export {
  callSignal,
  inCall,
  noteWriteSent,
  offerLink,
  pause,
  PROGRESS_INTERVAL_MS,
  progressSender,
  reportProgress,
  unlessCancelled,
  type LinkForPerson,
  type Progress,
} from "./call.js";
export { LINK_ANSWER_KEY, type LinkAnswer } from "./serve/link.js";
export {
  decodeBase64Strict,
  fileRootsFrom,
  INPUT_FILE_MAX_BYTES,
  inputFilesFrom,
  inputFilesWith,
  parseSha256,
  readInputFile,
  sha256Of,
  type FileSource,
  type InputFile,
  type InputFileOptions,
  type InputFiles,
  type InputFilesOptions,
} from "./inputFile.js";
export { asInputFileError, failInputFile, inputFileRemedy, type InputFileCode, type InputFileError } from "./inputFileErrors.js";
export { clientRoots, pathsOfRoots, shareClientRoots, shareRootsOf } from "./clientRoots.js";
export {
  confirmingClient,
  connectInMemory,
  connectSmoke,
  definedEnv,
  elicitingClient,
  smokeTarget,
  testClient,
  toolJson,
  type ElicitAnswer,
  type Elicited,
  type SmokeOptions,
  type SmokeTarget,
} from "./smoke.js";
export {
  Client,
  getDefaultEnvironment,
  InMemoryTransport,
  McpServer,
  StdioClientTransport,
  StreamableHTTPClientTransport,
  type CallToolResult,
  type Implementation,
  type ProtocolEra,
  type Tool,
  type ToolAnnotations,
  type Transport,
} from "./mcp.js";
