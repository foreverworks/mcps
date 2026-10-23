/**
 * App Store Connect's wire shapes (JSON:API), as its OpenAPI specification 4.5.1
 * gives them (developer.apple.com, App Store Connect API, 2026-10-22): only the
 * fields this server selects, every one optional, mapped inward by
 * appStore/mapping.ts, which fails as `drift` on a documented field gone.
 */
export type Ref = { readonly type?: string; readonly id?: string };

export type Resource<A> = {
  readonly type?: string;
  readonly id?: string;
  readonly attributes?: A;
  readonly relationships?: Readonly<Record<string, { readonly data?: Ref | null } | undefined>>;
};

export type ListDocument<A> = {
  readonly data?: readonly Resource<A>[];
  readonly included?: readonly Resource<Readonly<Record<string, unknown>>>[];
  readonly links?: { readonly next?: string };
  readonly meta?: { readonly paging?: { readonly nextCursor?: string } };
};

export type OneDocument<A> = { readonly data?: Resource<A> | null; readonly included?: readonly Resource<Readonly<Record<string, unknown>>>[] };

export type AppAttributes = { readonly name?: string; readonly bundleId?: string };

export type CustomerReviewAttributes = {
  readonly rating?: number;
  readonly title?: string;
  readonly body?: string;
  readonly reviewerNickname?: string;
  readonly createdDate?: string;
  readonly territory?: string;
};

export type ResponseAttributes = { readonly responseBody?: string; readonly lastModifiedDate?: string; readonly state?: "PUBLISHED" | "PENDING_PUBLISH" };

export type FeedbackAttributes = {
  readonly createdDate?: string;
  readonly comment?: string | null;
  readonly email?: string | null;
  readonly deviceModel?: string | null;
  readonly osVersion?: string | null;
  readonly locale?: string | null;
  readonly appPlatform?: string | null;
  readonly buildBundleId?: string | null;
  readonly screenshots?: readonly { readonly url?: string; readonly width?: number; readonly height?: number; readonly expirationDate?: string }[];
};

export type BuildAttributes = { readonly version?: string };

export type CrashLogAttributes = { readonly logText?: string };
