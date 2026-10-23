import { type ApiRequest, checkRequests, type Discovery } from "./discovery.js";
import { type AppError, fail, inputError, STALE_REVISION } from "./errors.js";

/**
 * What the three batch tools share: requests checked against the API's schema
 * before anything is sent, and the answer reduced to what a model reads. Pure.
 */

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The requests, or a refusal listing every problem the schema finds, before any of them is sent. */
export const checked = (api: Discovery, requests: readonly unknown[]): readonly ApiRequest[] => {
  const problems = checkRequests(api, requests);
  if (problems.length === 0) return requests as readonly ApiRequest[];
  return fail(
    inputError(
      `${problems.length === 1 ? "a request does" : `${problems.length} problems: the requests do`} not match the ${api.name} API ` +
        `(revision ${api.revision}); nothing was sent: ${problems.join("; ")}. editors_api_reference (api "${api.name}", name the request kind) lists what each takes`,
    ),
  );
};

/**
 * The replies worth reading, each with the position of the request it
 * answers: the ids and counts Google made (a header's id, a new sheet's
 * properties, how many occurrences were replaced). Requests that answer
 * nothing answer `{}`, and are left out.
 */
export const repliesOf = (replies: readonly unknown[] | null | undefined): readonly Readonly<Record<string, unknown>>[] =>
  (replies ?? []).flatMap((reply, request) => (isObject(reply) && Object.keys(reply).length > 0 ? [{ request, ...reply }] : []));

/** What Google said, from the body it answered with: the kit's own message names only the call. */
const googleSays = (body: unknown): string => {
  const error = isObject(body) && isObject(body.error) ? body.error : undefined;
  return typeof error?.message === "string" ? error.message : "";
};

/**
 * A pinned batch refused because the file moved on: Docs and Slides answer a
 * required revision that is no longer the latest with a plain 400 whose words
 * say so ("The required revision ID '...' does not match the latest
 * revision."). Reported as stale_revision, with Google's sentence.
 */
export const staleRevision = (error: AppError | undefined, pinned: boolean): AppError | undefined => {
  if (!pinned || error?.kind !== "api" || error.status !== 400) return undefined;
  const said = googleSays(error.body);
  return /revision/i.test(`${said} ${error.message}`) ? { ...error, reason: STALE_REVISION, ...(said ? { message: said } : {}) } : undefined;
};
