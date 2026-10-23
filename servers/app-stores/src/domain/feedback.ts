/**
 * TestFlight feedback as App Store Connect keeps it: what a tester sent from
 * the TestFlight app, with a screenshot or after a crash, and the build and
 * device it came from.
 */
export type FeedbackKind = "crash" | "screenshot";

export type Screenshot = { readonly url: string; readonly width: number | null; readonly height: number | null; readonly expiresAt: string | null };

export type Feedback = {
  readonly id: string;
  readonly kind: FeedbackKind;
  readonly at: string;
  /** What the tester wrote; null when they sent none. */
  readonly comment: string | null;
  /** The tester's e-mail, as TestFlight passes it on; null when withheld. */
  readonly tester: string | null;
  readonly device: { readonly model: string | null; readonly os: string | null; readonly platform: string | null };
  /** The build it came from: its build number, and the bundle id it was built as. */
  readonly build: { readonly id: string | null; readonly number: string | null; readonly bundleId: string | null };
  readonly locale?: string;
  /** Screenshot feedback: the images, at URLs that expire. */
  readonly screenshots?: readonly Screenshot[];
};

/** Newest first, across kinds: what a person reads as one inbox. */
export const newestFirst = (items: readonly Feedback[]): readonly Feedback[] => [...items].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

/** The first lines of a crash log, which name the exception and the crashed thread in either of Apple's formats. */
export const headOf = (log: string, lines = 40): readonly string[] => log.split(/\r?\n/).slice(0, lines);
