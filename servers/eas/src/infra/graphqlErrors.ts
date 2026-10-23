import type { AppError } from "../domain/errors.js";

/**
 * EAS's GraphQL errors, as they come (2026-10-03, read back):
 *
 *   {"message": "Experience with id '...' does not exist.",
 *    "extensions": {"code": "INTERNAL_SERVER_ERROR", "errorCode": "EXPERIENCE_NOT_FOUND",
 *                   "errorType": "USER", "isTransient": false}}
 *   {"message": "Invalid UUID buildId", "extensions": {"errorCode": "VALIDATION_ERROR", "errorType": "USER"}}
 *   {"message": "Cannot query field \"x\" on type \"RootQuery\".",
 *    "extensions": {"code": "GRAPHQL_VALIDATION_FAILED", "errorType": "SYSTEM"}}
 *
 * `errorCode` is the specific reason, `errorType` says whose fault it is, and
 * `isTransient` whether the same request may work later.
 */
export type GraphqlError = {
  readonly message?: string;
  readonly extensions?: {
    readonly code?: string;
    readonly errorCode?: string;
    readonly errorType?: string;
    readonly isTransient?: boolean;
    /**
     * A VALIDATION_ERROR's own list, where the validator gives one (a workflow
     * file's, read by eas-cli 25.3 as `ValidationErrorExtensionZ`):
     * `{"formErrors": ["..."], "fieldErrors": {"jobs.build.params": ["..."]}}`.
     */
    readonly metadata?: { readonly formErrors?: unknown; readonly fieldErrors?: unknown };
  };
};

const strings = (value: unknown): readonly string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

/** Each problem a validator named, a field's prefixed with its path: "jobs.build.params.platform: Required". */
export const issuesOf = (errors: readonly GraphqlError[]): readonly string[] =>
  errors.flatMap((e) => {
    const metadata = e.extensions?.errorCode === "VALIDATION_ERROR" ? e.extensions.metadata : undefined;
    if (metadata === undefined) return [];
    const fields = typeof metadata.fieldErrors === "object" && metadata.fieldErrors !== null ? Object.entries(metadata.fieldErrors) : [];
    return [...strings(metadata.formErrors), ...fields.flatMap(([field, messages]) => strings(messages).map((m) => `${field}: ${m}`))];
  });

const FORBIDDEN = /UNAUTHORIZED|FORBIDDEN|PERMISSION|ACCESS_DENIED/;

/** The first error decides; the others are named in the message. */
export const graphqlFailure = (errors: readonly GraphqlError[], context: { readonly mutation: boolean; readonly status?: number }): AppError => {
  const [first] = errors;
  const message = errors.map((e) => e.message ?? "an unnamed error").join("; ");
  const code = first?.extensions?.errorCode ?? first?.extensions?.code;
  const withCode = code === undefined ? {} : { code };
  const ext = first?.extensions ?? {};
  if (ext.code === "GRAPHQL_VALIDATION_FAILED" || ext.code === "GRAPHQL_PARSE_FAILED") return { kind: "drift", message };
  if (ext.code === "UNAUTHENTICATED" || ext.errorCode === "AUTHENTICATION_ERROR") return { kind: "auth", message };
  if (ext.errorCode !== undefined && ext.errorCode.endsWith("_NOT_FOUND")) return { kind: "not_found", message, ...withCode };
  if ((ext.errorCode !== undefined && FORBIDDEN.test(ext.errorCode)) || /not authorized|permission/i.test(message)) {
    return { kind: "forbidden", message, ...withCode };
  }
  if (ext.errorCode === "VALIDATION_ERROR" || ext.code === "BAD_USER_INPUT") {
    const issues = issuesOf(errors);
    return { kind: "input", message, ...withCode, ...(issues.length === 0 ? {} : { issues }) };
  }
  if (ext.isTransient === true || ext.errorType !== "USER") {
    return context.mutation ? { kind: "outcome_unknown", message } : { kind: "api", status: context.status ?? 200, message, ...withCode };
  }
  return { kind: "refused", message, ...withCode };
};
