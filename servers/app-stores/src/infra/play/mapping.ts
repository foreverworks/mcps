import { fail } from "../../domain/errors.js";
import type { Reply, Review } from "../../domain/reviews.js";
import type { DeveloperComment, PlayReview, Timestamp } from "./schema.js";

const need = <T>(value: T | undefined | null, what: string): T =>
  value === undefined || value === null ? fail({ kind: "drift", store: "play", message: `Google Play's answer had no ${what}` }) : value;

/** Google's `{seconds, nanos}` as an ISO instant, to the second. */
export const isoOf = (t: Timestamp | undefined): string | null => {
  const seconds = Number(t?.seconds);
  return t?.seconds === undefined || !Number.isFinite(seconds) ? null : new Date(seconds * 1000).toISOString().replace(".000Z", "Z");
};

export const replyOf = (c: DeveloperComment | undefined): Reply | null => (c?.text === undefined ? null : { text: c.text.trim(), at: isoOf(c.lastModified) });

/** One review: the user's latest comment (Play keeps only the latest), and the developer's reply. */
export const reviewFrom = (r: PlayReview): Review => {
  const user = (r.comments ?? []).find((c) => c.userComment !== undefined)?.userComment;
  const developer = (r.comments ?? []).find((c) => c.developerComment !== undefined)?.developerComment;
  const u = need(user, "user comment of a review");
  return {
    id: need(r.reviewId, "reviewId of a review"),
    rating: need(u.starRating, "starRating of a review"),
    text: (u.text ?? "").trim(),
    author: r.authorName === undefined || r.authorName === "" ? null : r.authorName,
    at: need(isoOf(u.lastModified), "lastModified of a review"),
    ...(u.reviewerLanguage === undefined ? {} : { language: u.reviewerLanguage }),
    ...(u.appVersionName === undefined ? {} : { appVersion: u.appVersionName }),
    ...(u.device === undefined ? {} : { device: u.device }),
    ...(u.androidOsVersion === undefined ? {} : { androidApi: u.androidOsVersion }),
    reply: replyOf(developer),
  };
};
