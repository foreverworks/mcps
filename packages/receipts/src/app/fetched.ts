/**
 * One order's receipt in a batch, or the reason it could not be read.
 *
 * One order the app will not return is REPORTED, never thrown, so it cannot
 * lose the batch. A dead token or a dead network is thrown: it would fail every
 * row the same way, and hundreds of copies of one error is not a report.
 */
export type Fetched<R> =
  | { readonly ok: true; readonly receipt: R }
  | { readonly ok: false; readonly orderId: number; readonly reason: string };

/** How a server tells a failure of one order from one that would fail them all. */
export type Failures<E extends { readonly message: string }> = {
  readonly asAppError: (thrown: unknown) => E | undefined;
  readonly isSystemic: (error: E) => boolean;
};

export const fetchOne = async <R, E extends { readonly message: string }>(
  orderId: number,
  read: () => Promise<R>,
  failures: Failures<E>,
): Promise<Fetched<R>> => {
  try {
    return { ok: true, receipt: await read() };
  } catch (thrown) {
    const error = failures.asAppError(thrown);
    if (error === undefined || failures.isSystemic(error)) throw thrown;
    return { ok: false, orderId, reason: error.message };
  }
};

/** The unreadable orders of a batch, as the tools report them. */
export const unreadable = <R>(fetched: readonly Fetched<R>[]) =>
  fetched.flatMap((f) => (f.ok ? [] : [{ orderId: f.orderId, reason: f.reason }]));
