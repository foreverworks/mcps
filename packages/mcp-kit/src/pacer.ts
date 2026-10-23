import type { Sleep } from "./http.js";
import { take, type Bucket } from "./serve/limits.js";

/** Injected by tests; real time otherwise. */
export type PacerClock = { readonly sleep?: Sleep; readonly now?: () => number };

const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One call at a time, their starts at least `gapMs` apart, across every caller
 * in the process. For an API that throttles bursts rather than volume: both
 * delivery apps refused calls fired back to back and never refused the same
 * calls spaced out (the measured gaps are in bolt-food's and glovo's adapters),
 * and ANAF's VAT registry allows one request a second per client. A failed
 * call does not stall the queue behind it.
 */
export const makePacer = (gapMs: number, { sleep = realSleep, now = Date.now }: PacerClock = {}) => {
  let lastStart = 0;
  let queue: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(async () => {
      const wait = lastStart + gapMs - now();
      if (wait > 0) await sleep(wait);
      lastStart = now();
      return fn();
    });
    queue = run.catch(() => undefined);
    return run;
  };
};

/** At most `burst` at once, then `ratePerSec`: any window of W seconds sees at most burst + rate x W calls. */
export type Pace = { readonly ratePerSec: number; readonly burst: number };

export type Throttle = <T>(run: () => Promise<T>) => Promise<T>;

export type ThrottleClock = {
  /** Milliseconds. */
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<unknown>;
};

/**
 * An API's documented rate limit, kept on this side of the wire: a token bucket
 * (the same `take` the HTTP transport limits its own callers with), and callers
 * wait their turn in order. For an API that limits VOLUME per window (Oblio,
 * Notion) rather than bursts (`makePacer`). Waiting here costs the same time as
 * a 429 and its backoff, and wastes no request; a 429 on a write is a refused
 * document. Per process: under a service, every session it serves shares it.
 */
export const makeThrottle = (pace: Pace, { now, sleep }: ThrottleClock): Throttle => {
  let bucket: Bucket | undefined;
  /** The queue: each caller waits for the one before it to get its turn. */
  let turn: Promise<void> = Promise.resolve();

  const admitted = async (): Promise<void> => {
    for (;;) {
      const step = take(bucket, now(), pace);
      bucket = step.bucket;
      if (step.allowed) return;
      await sleep(step.retryAfterSec * 1000);
    }
  };

  return async <T>(run: () => Promise<T>): Promise<T> => {
    const mine = turn.then(admitted);
    turn = mine;
    await mine;
    return run();
  };
};
