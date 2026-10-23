import { AsyncLocalStorage } from "node:async_hooks";

import { failGuard } from "./guardErrors.js";

/**
 * The tool call a piece of code runs in: the request's abort signal and a way
 * to tell the client how far along it is, without threading either through
 * every port. The guard runs each call inside one (serve/guard.ts); code that
 * runs outside a call (a shell mode, a test of an adapter alone) sees none, so
 * nothing is cancelled and progress goes nowhere.
 *
 * The signal fires when the client cancels the request (notifications/cancelled)
 * or goes away (the HTTP connection closes, stdio ends). `makeHttp` honours it
 * for reads; a write ignores it once its request is sent (http.ts), and the call
 * remembers that one was sent: a cancellation after that point ends the call as
 * `outcome_unknown`, never as a plain `cancelled`, because the write may have
 * happened, and nothing sends it again.
 */
export type Progress = (progress: number, total?: number, message?: string) => void;

/**
 * A link a call hands a person to open: a sign-in, a consent, a page only they
 * can act on. `url` is the value the result reports it under; `message` is
 * the one line the client shows the person beside it (what to do there and
 * what comes after); `next` is what the result says to do next once the
 * person has the page open, in place of the result's own `next`, which tells
 * the model to hand the link over (serve/link.ts).
 */
export type LinkForPerson = { readonly url: string; readonly message: string; readonly next: string };

type Call = {
  readonly signal?: AbortSignal;
  readonly progress: Progress;
  readonly offer: (link: LinkForPerson) => void;
  readonly wrote: { sent: boolean };
};

const calls = new AsyncLocalStorage<Call>();

/** Runs `fn` as the call `signal` belongs to, reporting progress through `progress` and links through `offer`. */
export const inCall = <T>(
  call: { readonly signal?: AbortSignal | undefined; readonly progress?: Progress | undefined; readonly offer?: ((link: LinkForPerson) => void) | undefined },
  fn: () => T,
): T =>
  calls.run(
    {
      ...(call.signal === undefined ? {} : { signal: call.signal }),
      progress: call.progress ?? (() => undefined),
      offer: call.offer ?? (() => undefined),
      wrote: { sent: false },
    },
    fn,
  );

/**
 * The current call's result hands a person this link. Where the client can
 * offer a link to its user itself (MCP URL elicitation), the guard asks it to
 * once the call has succeeded, and the result says what the person answered;
 * elsewhere the result goes out as the call returned it, link included. The
 * last link offered in a call is the one asked about.
 */
export const offerLink = (link: LinkForPerson): void => calls.getStore()?.offer(link);

/** A request that is not idempotent is about to leave in the current call (http.ts). */
export const noteWriteSent = (): void => {
  const call = calls.getStore();
  if (call !== undefined) call.wrote.sent = true;
};

/** The current call's abort signal, if this runs inside a call. */
export const callSignal = (): AbortSignal | undefined => calls.getStore()?.signal;

/**
 * Tells the client how far the current call is: `progress` of `total` (when it
 * is known), with a short message. Sent only when the client asked for progress
 * (a progressToken on the request); never fails the call.
 */
export const reportProgress: Progress = (progress, total, message) => calls.getStore()?.progress(progress, total, message);

/**
 * Stops here if the client cancelled the current call: nothing after this point
 * runs. Before any write left, that is `cancelled`; after one did, it is
 * `outcome_unknown`, since the write may have happened.
 */
export const unlessCancelled = (what: string): void => {
  const call = calls.getStore();
  if (call?.signal?.aborted !== true) return;
  if (call.wrote.sent) failGuard({ kind: "outcome_unknown", message: `the client cancelled the call after a write was sent, which may have happened; ${what}` });
  failGuard({ kind: "cancelled", message: `the client cancelled the call; ${what}` });
};

/** Waits `ms` with `sleep`, returning early (and failing as cancelled) if the client cancels meanwhile. */
export const pause = async (ms: number, sleep: (ms: number) => Promise<unknown>, what: string): Promise<void> => {
  const signal = callSignal();
  if (signal === undefined) {
    await sleep(ms);
    return;
  }
  unlessCancelled(what);
  const aborted = new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
  await Promise.race([sleep(ms), aborted]);
  unlessCancelled(what);
};

/** Progress notifications at most this often; the last one (progress = total) always goes. */
export const PROGRESS_INTERVAL_MS = 250;

/**
 * The progress reporter for a request that carries `token`: notifications in
 * increasing order (the spec requires it; an equal or lower value is dropped),
 * no more often than PROGRESS_INTERVAL_MS except the final one, and a failure
 * to send (the client gone) ignored, since progress is a courtesy.
 */
export const progressSender = (
  token: string | number,
  send: (notification: { method: "notifications/progress"; params: { progressToken: string | number; progress: number; total?: number; message?: string } }) => Promise<void>,
  now: () => number = Date.now,
): Progress => {
  const last = { progress: Number.NEGATIVE_INFINITY, at: Number.NEGATIVE_INFINITY };
  return (progress, total, message) => {
    if (!(progress > last.progress)) return;
    const final = total !== undefined && progress >= total;
    if (!final && now() - last.at < PROGRESS_INTERVAL_MS) return;
    last.progress = progress;
    last.at = now();
    void send({
      method: "notifications/progress",
      params: { progressToken: token, progress, ...(total === undefined ? {} : { total }), ...(message === undefined ? {} : { message }) },
    }).catch(() => undefined);
  };
};
