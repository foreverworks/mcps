import { fail, inputError } from "./errors.js";

/**
 * How the presses of one call are spaced. The pause between two presses is
 * the call's `interval_ms`, else the device's in the catalog, else PAUSE_MS.
 * A button marked `wake` (the device's first press only wakes it, lighting
 * its display) gets one press more, first, followed by the same pause. Pure.
 */

/** The default pause: longer than an NEC remote's 108 ms frame period and the repeat code each press carries, so every press reads as a new one. */
export const PAUSE_MS = 400;

/** A pause a call or the catalog may ask for: never shorter than the default, so presses never merge into one held button. */
export const MIN_PAUSE_MS = PAUSE_MS;
export const MAX_PAUSE_MS = 10_000;

/** The longest one call waits between its presses in all, so it answers well before a client stops waiting; longer runs are several calls. */
export const MAX_WAIT_MS = 20_000;

export type PressPlan = {
  /** Every press that goes out, the wake press included. */
  readonly presses: number;
  readonly wake: boolean;
  readonly pauseMs: number;
};

export const seconds = (ms: number): string => `${ms / 1000} s`;

/** The presses `times` asks for, plus the wake press when there is one, or an input failure when they would wait too long in all. */
export const planPresses = (a: { readonly times: number; readonly wake: boolean; readonly pauseMs: number }): PressPlan => {
  const presses = a.times + (a.wake ? 1 : 0);
  const waitMs = (presses - 1) * a.pauseMs;
  if (waitMs > MAX_WAIT_MS) {
    fail(
      inputError(
        `${presses} presses${a.wake ? " (one of them to wake the device)" : ""} ${seconds(a.pauseMs)} apart wait ${seconds(waitMs)} in all, and one call waits ` +
          `at most ${seconds(MAX_WAIT_MS)}: ask for fewer presses or a shorter interval_ms, or make several calls; nothing was sent`,
      ),
    );
  }
  return { presses, wake: a.wake, pauseMs: a.pauseMs };
};
