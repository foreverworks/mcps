import { asGuardError, guardRemedy } from "./guardErrors.js";
import { collectHandedBack } from "./handedBack.js";
import type { ResourceLink } from "./outbox.js";
import { asInputFileError, inputFileRemedy } from "./inputFileErrors.js";

/**
 * The one contract every tool in this repo shares.
 *
 * Tools return results rather than raising, because a raise becomes a
 * protocol-level failure and reads worse. But a bare error STRING is
 * indistinguishable from a successful empty result, so the SHAPE carries the
 * verdict: a top-level `error` key means the call did not happen. Such a
 * result is also flagged `isError`, which is what MCP clients read.
 *
 * What is NOT shared is the vocabulary. Each server passes in its own
 * `asAppError` and its own `remedyFor`, because a remedy is the one sentence
 * that says what an operator should do about this particular integration. The
 * exceptions are the kit's guard and its input-file helper, identical
 * in every server, whose failures every envelope recognises.
 *
 * Compact JSON, not pretty-printed: the text lands in a model's context, where
 * indentation is paid for in tokens and read by nobody. On typical list and
 * search results it is 13-29% smaller.
 */

export type ToolResult = {
  /** The JSON, then a link to each file the call handed back (handedBack.ts), on success only. */
  readonly content: [{ readonly type: "text"; readonly text: string }, ...ResourceLink[]];
  readonly isError?: true;
};

/** How each result came out, for the audit line; kept off the wire. */
const outcomes = new WeakMap<object, string>();

const text = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

/** A failed call, in the shape every tool here answers with. */
export const failure = (error: { readonly kind: string }, remedy: string): ToolResult => {
  const result: ToolResult = { ...text({ error: { ...error, remedy } }), isError: true };
  outcomes.set(result, error.kind);
  return result;
};

/** `ok`, or the failure's kind; `error` for a failure some other code produced. */
export const outcomeOf = (result: unknown): string =>
  typeof result === "object" && result !== null
    ? (outcomes.get(result) ?? ((result as { isError?: unknown }).isError === true ? "error" : "ok"))
    : "ok";

export type EnvelopeVocabulary<E> = {
  readonly asAppError: (thrown: unknown) => E | undefined;
  /** One sentence: what the operator should do about it. */
  readonly remedyFor: (error: E) => string;
};

/** A thrown value as a result: the kit's guard and input-file failures, this server's own, or a bug. */
export const asFailure = <E extends object>(thrown: unknown, { asAppError, remedyFor }: EnvelopeVocabulary<E>): ToolResult => {
  const refused = asGuardError(thrown);
  if (refused !== undefined) return failure(refused, guardRemedy(refused));
  const file = asInputFileError(thrown);
  if (file !== undefined) return failure(file, inputFileRemedy(file));
  const known = asAppError(thrown);
  return known === undefined
    ? failure({ kind: "unexpected", message: String(thrown) } as { kind: string }, "report this; it is a bug")
    : failure(known as E & { kind: string }, remedyFor(known));
};

/**
 * Build this server's `handled`, which wraps a controller so no failure ever
 * escapes as a protocol error.
 *
 * An unrecognised throw is reported as `unexpected` rather than swallowed: it
 * is a bug in this server, and saying so is more useful than a blank result.
 * A file the call saved to its outbox is linked after the JSON (handedBack.ts);
 * a failure links nothing, whatever was saved before it failed.
 */
export const makeHandled = <E extends object>(vocabulary: EnvelopeVocabulary<E>) => {
  return <A extends unknown[]>(fn: (...args: A) => Promise<unknown>) =>
    async (...args: A): Promise<ToolResult> => {
      try {
        const { value, links } = await collectHandedBack(() => fn(...args));
        const result = text(value);
        return links.length === 0 ? result : { content: [result.content[0], ...links] };
      } catch (thrown) {
        return asFailure(thrown, vocabulary);
      }
    };
};
