import { makeErrorKit, makeRequired } from "@foreverworks/mcp-kit";

/**
 * The ways this server fails, as plain tagged data (packages/mcp-kit, errors.ts):
 * no classes, no `instanceof`, so a failure survives serialisation and a
 * module boundary.
 *
 * EAS answers a GraphQL request with HTTP 200 and an `errors` list whose
 * `extensions` say what happened (`errorCode`, `errorType` USER or SYSTEM,
 * `isTransient`); only a refused token is a plain 401. infra/graphql.ts turns
 * both into the kinds below.
 */
export type AppError =
  /** No token: neither EXPO_TOKEN_FILE nor EXPO_TOKEN, or the file cannot be read. Nothing was sent. */
  | { readonly kind: "config"; readonly message: string }
  /** 401: EAS refused the token (revoked, or the robot was deleted). */
  | { readonly kind: "auth"; readonly message: string }
  /** The token works but its actor may not do this (a viewer robot asked to write, another account's project). */
  | { readonly kind: "forbidden"; readonly message: string; readonly code?: string }
  /** No such project, build, run, job, submission, bundle or key, as EAS or this server looked it up. */
  | { readonly kind: "not_found"; readonly message: string; readonly code?: string }
  /**
   * The arguments cannot become a request, or EAS refused them as invalid. Nothing changed.
   * `issues` are the validator's own, one per problem, where it names them (a workflow file's).
   */
  | { readonly kind: "input"; readonly message: string; readonly code?: string; readonly issues?: readonly string[] }
  /** EAS understood the request and declined it (a build already finished, a workflow file not on that ref). Nothing changed. */
  | { readonly kind: "refused"; readonly message: string; readonly code?: string }
  /** Still 429 after the retries. */
  | { readonly kind: "rate_limited"; readonly message: string }
  /** A change that failed AFTER it may have reached EAS: a 5xx or a dropped connection on a mutation. */
  | { readonly kind: "outcome_unknown"; readonly message: string }
  /** EAS was unreachable or unwell (status 0 is no connection), or said its own error is transient. */
  | { readonly kind: "api"; readonly status: number; readonly message: string; readonly code?: string }
  /**
   * EAS no longer accepts a query this server sends (a field is gone or renamed:
   * GRAPHQL_VALIDATION_FAILED), or answered without a field it always had.
   */
  | { readonly kind: "drift"; readonly message: string };

export type Kind = AppError["kind"];

export const configError = (message: string): AppError => ({ kind: "config", message });
export const inputError = (message: string): AppError => ({ kind: "input", message });
export const notFound = (message: string): AppError => ({ kind: "not_found", message });

export const { fail, asAppError } = makeErrorKit<AppError>("eas");

/** A field this server selected and cannot do without, missing from the answer. */
export const required = makeRequired((what) => fail({ kind: "drift", message: `EAS's answer had no ${what}` }));

/** What to do about it, in one sentence. */
export const remedyFor = (error: AppError): string => {
  switch (error.kind) {
    case "config":
      return "give the server an Expo access token: EXPO_TOKEN_FILE naming a file that holds it (on a service, its credentials directory), or EXPO_TOKEN; a robot user's token is made at expo.dev, account settings, Robots";
    case "auth":
      return "EAS refused the token: check the robot and its token still exist at expo.dev (account settings, Robots, Access tokens), and replace the service's token file if it was revoked; it is re-read on the next call";
    case "forbidden":
      return "the token's robot lacks a permission for this (writes need the Developer role on the project's account); change its role at expo.dev, account settings, Members";
    case "not_found":
      return "check the id or name (list_projects, list_builds, list_workflow_runs and list_submissions give them); a project of another account is invisible to this token";
    case "input":
      return "fix what the message names and call again; nothing was changed";
    case "refused":
      return "EAS declined it as the message says; nothing was changed";
    case "rate_limited":
      return "EAS is throttling this token; wait a minute and retry";
    case "outcome_unknown":
      return "look before repeating it (get_build, get_workflow_run, list_submissions): the change may already have happened, and repeating a dispatch or a submission does it twice";
    case "api":
      return error.status === 0 ? "EAS was unreachable; retry later" : "EAS failed; retry later, and check status.expo.dev if it persists";
    case "drift":
      return "EAS's API changed under this server (a query no longer validates); the server needs updating, report it with the message";
  }
};
