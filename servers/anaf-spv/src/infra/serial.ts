/**
 * One at a time, in call order: each run starts when the previous one has
 * settled, whether it succeeded or not. In-process only; the sign-in also
 * takes a file lock (store.ts) for other processes on the same state dir.
 */
export const makeSerial = () => {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  };
};
