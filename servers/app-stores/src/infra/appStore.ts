import { bearer, compact, makeTokenSource, memoryTokenStore, type Query } from "@foreverworks/mcp-kit";

import type { AppStorePort, AscReviewQuery } from "../app/ports.js";
import { fail } from "../domain/errors.js";
import type { FeedbackKind } from "../domain/feedback.js";
import type { AscKey } from "./credentials.js";
import { makeStoreHttp, type StoreHttpOptions } from "./http.js";
import { feedbackFrom, nextCursorOf, oneReviewFrom, replyFrom, reviewsFrom } from "./appStore/mapping.js";
import type { AppAttributes, CrashLogAttributes, CustomerReviewAttributes, FeedbackAttributes, ListDocument, OneDocument, ResponseAttributes } from "./appStore/schema.js";
import { type ClockOptions, epochSeconds, signJwt } from "./jwt.js";

export const ASC_API = "https://api.appstoreconnect.apple.com";

/** Apple's ceiling for a token's life is 20 minutes; one is made for 19 and replaced a minute early. */
const TOKEN_SECONDS = 19 * 60;

const REVIEW_FIELDS = {
  include: "response",
  "fields[customerReviews]": "rating,title,body,reviewerNickname,createdDate,territory,response",
  "fields[customerReviewResponses]": "responseBody,lastModifiedDate,state",
} as const;

const FEEDBACK: Readonly<Record<FeedbackKind, { readonly path: string; readonly fields: string }>> = {
  crash: { path: "betaFeedbackCrashSubmissions", fields: "createdDate,comment,email,deviceModel,osVersion,locale,appPlatform,buildBundleId,build" },
  screenshot: { path: "betaFeedbackScreenshotSubmissions", fields: "createdDate,comment,email,deviceModel,osVersion,locale,appPlatform,buildBundleId,screenshots,build" },
};

const SORT: Readonly<Record<AscReviewQuery["sort"], string>> = { newest: "-createdDate", oldest: "createdDate", highest: "-rating", lowest: "rating" };

/**
 * App Store Connect's REST API with a team API key. Each request carries a
 * token this server signs itself (ES256, audience appstoreconnect-v1), kept
 * in memory for its 19 minutes; no token endpoint is involved.
 */
export const makeAppStore = (key: () => Promise<AscKey>, options: StoreHttpOptions & ClockOptions = {}, base = ASC_API): AppStorePort => {
  const now = options.nowEpoch ?? epochSeconds;
  const tokens = makeTokenSource({
    store: memoryTokenStore(),
    nowEpoch: now,
    mint: async () => {
      const { keyId, issuerId, key: privateKey } = await key();
      const iat = now();
      return { token: signJwt("ES256", { kid: keyId }, { iss: issuerId, iat, exp: iat + TOKEN_SECONDS, aud: "appstoreconnect-v1" }, privateKey), expiresAtEpoch: iat + TOKEN_SECONDS };
    },
  });
  const { nowEpoch: _now, ...httpOptions } = options;
  const http = makeStoreHttp("app_store", bearer(tokens), httpOptions);
  const get = <T>(path: string, query: Query = {}) => http<T>(`${base}${path}`, { query });

  return {
    apps: async (bundleId) => {
      const doc = await get<ListDocument<AppAttributes>>("/v1/apps", compact({ "fields[apps]": "name,bundleId", limit: 200, "filter[bundleId]": bundleId }));
      return (doc.data ?? []).map((a) => ({ id: a.id ?? fail({ kind: "drift", store: "app_store", message: "an app without an id" }), bundleId: a.attributes?.bundleId ?? "", name: a.attributes?.name ?? "" }));
    },

    reviews: async (appId, q) => {
      const doc = await get<ListDocument<CustomerReviewAttributes>>(
        `/v1/apps/${encodeURIComponent(appId)}/customerReviews`,
        compact({
          ...REVIEW_FIELDS,
          sort: SORT[q.sort],
          limit: q.limit,
          cursor: q.cursor,
          "filter[rating]": q.ratings === undefined || q.ratings.length === 0 ? undefined : q.ratings.join(","),
          "filter[territory]": q.territory,
          "exists[publishedResponse]": q.replied,
        }),
      );
      return { items: reviewsFrom(doc), ...compact({ nextCursor: nextCursorOf(doc) }) };
    },

    review: async (reviewId) => oneReviewFrom(await get<OneDocument<CustomerReviewAttributes>>(`/v1/customerReviews/${encodeURIComponent(reviewId)}`, REVIEW_FIELDS)),

    respond: async (reviewId, text) => {
      const doc = await http<OneDocument<ResponseAttributes>>(`${base}/v1/customerReviewResponses`, {
        method: "POST",
        json: { data: { type: "customerReviewResponses", attributes: { responseBody: text }, relationships: { review: { data: { type: "customerReviews", id: reviewId } } } } },
      });
      return replyFrom(doc.data ?? fail({ kind: "drift", store: "app_store", message: "App Store Connect answered a reply without the response" }));
    },

    feedback: async (appId, kind, q) => {
      const { path, fields } = FEEDBACK[kind];
      const doc = await get<ListDocument<FeedbackAttributes>>(
        `/v1/apps/${encodeURIComponent(appId)}/${path}`,
        compact({ include: "build", [`fields[${path}]`]: fields, "fields[builds]": "version", sort: "-createdDate", limit: q.limit, cursor: q.cursor }),
      );
      return { items: feedbackFrom(kind, doc), ...compact({ nextCursor: nextCursorOf(doc) }) };
    },

    crashLog: async (submissionId) => {
      const doc = await get<OneDocument<CrashLogAttributes>>(`/v1/betaFeedbackCrashSubmissions/${encodeURIComponent(submissionId)}/crashLog`, { "fields[betaCrashLogs]": "logText" });
      return doc.data?.attributes?.logText ?? fail({ kind: "drift", store: "app_store", message: "App Store Connect answered a crash log without its text" });
    },
  };
};
