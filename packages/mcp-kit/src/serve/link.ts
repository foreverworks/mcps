import type { LinkForPerson } from "../call.js";

/**
 * A link a call hands a person (a sign-in, a consent), offered to them by the
 * client itself where it can: an MCP URL elicitation. The client shows the
 * person the whole URL and the call's one line, opens it in their browser if
 * they accept, and neither the client nor the model sees the page. Without it
 * the URL travels in the result and the model has to pass it on, which is
 * the fallback for every client that cannot (and for the stateless HTTP
 * transport, which cannot carry a request back in the middle of a call).
 *
 * Nothing waits for the page to be finished: the servers here learn that from
 * the address the person brings back to a `complete_*` tool, matched to its
 * begun sign-in by the `state` in it, never from a notification. 2026-07-28
 * removed the completion notification, so this already works the way the new
 * revision does.
 */

/** What the person answered, in the spec's words. */
export type LinkAnswer = "accept" | "decline" | "cancel";

/** For the audit line: the answer, or why nobody was asked. */
export type LinkOutcome = LinkAnswer | "unsupported" | "failed";

/** The key a result reports the person's answer under. */
export const LINK_ANSWER_KEY = "client_offered_link";

type Sent = { readonly isError?: unknown; readonly content?: readonly { readonly type?: unknown; readonly text?: unknown }[] };

/**
 * The result once the person answered. Accepted: the person has the page, so
 * the URL leaves the result (the model has nothing to pass on) and `next`
 * becomes the link's own. Declined or cancelled: the result keeps the URL and
 * its `next`, since the person may want it sent elsewhere (another browser,
 * whoever holds the certificate), and a client may decline by policy without
 * asking anyone. Either way the answer is in the result. A result that is not
 * one JSON object, or a failure, goes out as it came.
 */
export const answeredResult = (result: unknown, link: LinkForPerson, answer: LinkAnswer): unknown => {
  const sent = result as Sent | undefined;
  const [first, ...rest] = sent?.content ?? [];
  if (sent?.isError === true || first?.type !== "text" || typeof first.text !== "string") return result;
  const value = ((): unknown => {
    try {
      return JSON.parse(first.text) as unknown;
    } catch {
      return undefined;
    }
  })();
  if (typeof value !== "object" || value === null || Array.isArray(value)) return result;
  const fields = Object.entries(value as Record<string, unknown>).filter(([key, v]) => key !== "next" && !(answer === "accept" && v === link.url));
  const next = answer === "accept" ? link.next : (value as Record<string, unknown>)["next"];
  const json = { ...Object.fromEntries(fields), [LINK_ANSWER_KEY]: answer, ...(next === undefined ? {} : { next }) };
  return { ...(result as object), content: [{ type: "text", text: JSON.stringify(json) }, ...rest] };
};
