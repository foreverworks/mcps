/**
 * Run an async load once per process, but only when it is first needed.
 *
 * Every server here reads a config file this way: lazily, so a missing file
 * surfaces as one tool answering "config" with a remedy rather than as a
 * process that died before it could be asked.
 *
 * A rejection is deliberately NOT cached. A config repaired while a session is
 * open should work on the next call rather than keep reporting a fault that has
 * already been fixed.
 */
export const once = <T>(load: () => Promise<T>): (() => Promise<T>) => {
  let pending: Promise<T> | undefined;
  return () =>
    (pending ??= load().catch((cause: unknown) => {
      pending = undefined;
      throw cause;
    }));
};
