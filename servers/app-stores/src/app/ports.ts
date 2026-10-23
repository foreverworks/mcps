/**
 * What the use cases need from each store, named as operations. Answers are
 * this server's own models (domain/); no URL, header or wire field appears
 * above infra/.
 */
import type { Feedback, FeedbackKind } from "../domain/feedback.js";
import type { Reply, Review } from "../domain/reviews.js";

export type Page<T> = { readonly items: readonly T[]; readonly nextCursor?: string };

/** An app as App Store Connect lists it. */
export type AscApp = { readonly id: string; readonly bundleId: string; readonly name: string };

export type AscReviewQuery = {
  readonly ratings?: readonly number[];
  readonly territory?: string;
  /** true: only reviews with a published reply; false: only those without. */
  readonly replied?: boolean;
  readonly sort: "newest" | "oldest" | "highest" | "lowest";
  readonly limit: number;
  readonly cursor?: string;
};

export type AppStorePort = {
  /** The apps the key sees, or the one with this bundle id. */
  readonly apps: (bundleId?: string) => Promise<readonly AscApp[]>;
  readonly reviews: (appId: string, query: AscReviewQuery) => Promise<Page<Review>>;
  /** One review with its reply, if it has one. */
  readonly review: (reviewId: string) => Promise<Review>;
  /** Publish a reply (Apple replaces the review's earlier one, if any); answers it as Apple keeps it. */
  readonly respond: (reviewId: string, text: string) => Promise<Reply>;
  readonly feedback: (appId: string, kind: FeedbackKind, query: { readonly limit: number; readonly cursor?: string }) => Promise<Page<Feedback>>;
  /** A crash submission's log, as text. */
  readonly crashLog: (submissionId: string) => Promise<string>;
};

export type PlayPort = {
  /** Mint a token with the service account: proves the key works, and names the account. */
  readonly check: () => Promise<{ readonly account: string }>;
  /** The reviews Google returns: those written or changed in the last week, newest first. */
  readonly reviews: (packageName: string, query: { readonly limit: number; readonly cursor?: string; readonly translateTo?: string }) => Promise<Page<Review>>;
  readonly review: (packageName: string, reviewId: string) => Promise<Review>;
  /** Publish a reply (Google replaces the review's earlier one, if any). */
  readonly reply: (packageName: string, reviewId: string, text: string) => Promise<Reply>;
};

export type OutboxPort = {
  readonly save: (name: string, bytes: Uint8Array) => Promise<{ readonly path: string; readonly sha256: string; readonly size: number }>;
};

export type Deps = {
  readonly appStore: AppStorePort;
  readonly play: PlayPort;
  /** The Play packages this deployment answers for (PLAY_PACKAGES): Google has no call that lists them. */
  readonly packages: readonly string[];
  readonly outbox: OutboxPort;
};
