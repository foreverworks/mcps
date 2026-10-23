/** The clock and the pause a mailbox watch polls with; tests pass their own. */
export type Poll = { readonly now: () => number; readonly sleep: (ms: number) => Promise<void>; readonly everyMs: number };

/** Check now, then every `everyMs`, until `check` finds something or the next check would start after `deadlineMs`. */
export const polling = async <T>(poll: Poll, deadlineMs: number, check: () => Promise<T | undefined>): Promise<T | undefined> => {
  for (;;) {
    const found = await check();
    if (found !== undefined) return found;
    if (poll.now() + poll.everyMs > deadlineMs) return undefined;
    await poll.sleep(poll.everyMs);
  }
};
