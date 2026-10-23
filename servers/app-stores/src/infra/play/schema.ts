/**
 * The Google Play Developer API's wire shapes for reviews (androidpublisher v3,
 * developers.google.com/android-publisher/api-ref/rest/v3/reviews, read
 * 2026-10-22): only the fields this server reads, every one optional, mapped
 * inward by play/mapping.ts.
 */
export type Timestamp = { readonly seconds?: string; readonly nanos?: number };

export type UserComment = {
  readonly text?: string;
  readonly lastModified?: Timestamp;
  readonly starRating?: number;
  readonly reviewerLanguage?: string;
  readonly device?: string;
  readonly androidOsVersion?: number;
  readonly appVersionName?: string;
};

export type DeveloperComment = { readonly text?: string; readonly lastModified?: Timestamp };

export type PlayReview = {
  readonly reviewId?: string;
  readonly authorName?: string;
  readonly comments?: readonly { readonly userComment?: UserComment; readonly developerComment?: DeveloperComment }[];
};

export type ReviewsList = { readonly reviews?: readonly PlayReview[]; readonly tokenPagination?: { readonly nextPageToken?: string } };

export type ReplyAnswer = { readonly result?: { readonly replyText?: string; readonly lastEdited?: Timestamp } };

/** The token endpoint's answer to a service account's signed assertion (RFC 7523). */
export type TokenAnswer = { readonly access_token?: string; readonly expires_in?: number };
