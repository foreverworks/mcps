/**
 * Reviews and replies as both stores have them, and the rules a reply follows
 * here. Pure: the adapters map each store's wire shapes into these.
 */

/** A developer's public reply under a review. */
export type Reply = {
  readonly text: string;
  /** When it was last written; null when the store does not say. */
  readonly at: string | null;
  /** App Store only: Apple publishes a reply after a review of its own. */
  readonly state?: "published" | "pending";
};

export type Review = {
  readonly id: string;
  /** 1 to 5 stars. */
  readonly rating: number;
  /** App Store only: the review's title. */
  readonly title?: string;
  readonly text: string;
  readonly author: string | null;
  /** When the review was written, or last changed (Play keeps only the latest text). */
  readonly at: string;
  /** App Store: the storefront, as Apple's three-letter territory code (ROU, USA). */
  readonly territory?: string;
  /** Play: the reviewer's language, e.g. ro or en_GB. */
  readonly language?: string;
  /** Play: the app version the review was written on. */
  readonly appVersion?: string;
  /** Play: the device's code name and Android API level. */
  readonly device?: string;
  readonly androidApi?: number;
  readonly reply: Reply | null;
};

/** The most a reply may hold: Apple's limit on a response, and Google's ("approximately 350 characters"). */
export const REPLY_MAX = { app_store: 5970, play: 350 } as const;

const same = (a: string, b: string): boolean => a.trim().replace(/\r\n/g, "\n") === b.trim().replace(/\r\n/g, "\n");

const excerpt = (text: string): string => (text.length > 160 ? `${text.slice(0, 157)}...` : text);

/**
 * Whether to send a reply. Both stores put a new reply in place of the old one
 * without saying so, and the old one is public, so a review that already has
 * a different reply is refused unless the caller says `replace`. The same text
 * again sends nothing: a repeated call is harmless.
 */
export const replyDecision = (
  review: Review,
  text: string,
  replace: boolean,
): { readonly send: true } | { readonly unchanged: true } | { readonly problem: string } => {
  if (review.reply === null) return { send: true };
  if (same(review.reply.text, text)) return { unchanged: true };
  if (!replace) {
    const when = review.reply.at === null ? "" : ` (${review.reply.at})`;
    return { problem: `review ${review.id} already has a public reply${when}: "${excerpt(review.reply.text)}"; to put this one in its place, call again with replace: true` };
  }
  return { send: true };
};
