import { fail } from "../../domain/errors.js";
import type { Feedback, FeedbackKind } from "../../domain/feedback.js";
import type { Reply, Review } from "../../domain/reviews.js";
import type { BuildAttributes, CustomerReviewAttributes, FeedbackAttributes, ListDocument, Resource, ResponseAttributes } from "./schema.js";

/** A field App Store Connect always sends, or `drift`. */
const need = <T>(value: T | undefined | null, what: string): T =>
  value === undefined || value === null ? fail({ kind: "drift", store: "app_store", message: `App Store Connect's answer had no ${what}` }) : value;

const orNull = <T>(value: T | undefined | null): T | null => (value === undefined ? null : value);

export const replyFrom = (r: Resource<ResponseAttributes>): Reply => ({
  text: need(r.attributes?.responseBody, "responseBody of a review response"),
  at: orNull(r.attributes?.lastModifiedDate),
  ...(r.attributes?.state === "PENDING_PUBLISH" ? { state: "pending" as const } : r.attributes?.state === "PUBLISHED" ? { state: "published" as const } : {}),
});

/** The included resources of a document, by type and id. */
const includedOf = (doc: { readonly included?: readonly Resource<Readonly<Record<string, unknown>>>[] }) => {
  const byKey = new Map((doc.included ?? []).map((r) => [`${r.type}/${r.id}`, r]));
  return (type: string, id: string | undefined) => (id === undefined ? undefined : byKey.get(`${type}/${id}`));
};

export const reviewFrom = (r: Resource<CustomerReviewAttributes>, included: ReturnType<typeof includedOf>): Review => {
  const a = need(r.attributes, "attributes of a customer review");
  const responseId = r.relationships?.["response"]?.data?.id;
  const response = included("customerReviewResponses", responseId) as Resource<ResponseAttributes> | undefined;
  return {
    id: need(r.id, "id of a customer review"),
    rating: need(a.rating, "rating of a customer review"),
    ...(a.title === undefined || a.title === "" ? {} : { title: a.title }),
    text: a.body ?? "",
    author: orNull(a.reviewerNickname),
    at: need(a.createdDate, "createdDate of a customer review"),
    ...(a.territory === undefined ? {} : { territory: a.territory }),
    reply: response === undefined ? null : replyFrom(response),
  };
};

export const reviewsFrom = (doc: ListDocument<CustomerReviewAttributes>): readonly Review[] => {
  const included = includedOf(doc);
  return need(doc.data, "data of a review list").map((r) => reviewFrom(r, included));
};

export const oneReviewFrom = (doc: { readonly data?: Resource<CustomerReviewAttributes> | null; readonly included?: readonly Resource<Readonly<Record<string, unknown>>>[] }): Review =>
  reviewFrom(need(doc.data, "data of a customer review"), includedOf(doc));

export const feedbackFrom = (kind: FeedbackKind, doc: ListDocument<FeedbackAttributes>): readonly Feedback[] => {
  const included = includedOf(doc);
  return need(doc.data, `data of a ${kind} feedback list`).map((r) => {
    const a = need(r.attributes, `attributes of ${kind} feedback`);
    const buildId = r.relationships?.["build"]?.data?.id;
    const build = included("builds", buildId) as Resource<BuildAttributes> | undefined;
    return {
      id: need(r.id, `id of ${kind} feedback`),
      kind,
      at: need(a.createdDate, `createdDate of ${kind} feedback`),
      comment: a.comment === undefined || a.comment === "" ? null : a.comment,
      tester: orNull(a.email),
      device: { model: orNull(a.deviceModel), os: orNull(a.osVersion), platform: orNull(a.appPlatform) },
      build: { id: orNull(buildId), number: orNull(build?.attributes?.version), bundleId: orNull(a.buildBundleId) },
      ...(a.locale === undefined || a.locale === null ? {} : { locale: a.locale }),
      ...(kind === "screenshot"
        ? {
            screenshots: (a.screenshots ?? []).map((s) => ({
              url: need(s.url, "url of a feedback screenshot"),
              width: orNull(s.width),
              height: orNull(s.height),
              expiresAt: orNull(s.expirationDate),
            })),
          }
        : {}),
    };
  });
};

/** The cursor App Store Connect's next link carries, which the next call sends back. */
export const nextCursorOf = (doc: ListDocument<unknown>): string | undefined => {
  if (doc.links?.next !== undefined) {
    const cursor = new URL(doc.links.next).searchParams.get("cursor");
    if (cursor !== null && cursor !== "") return cursor;
  }
  return doc.meta?.paging?.nextCursor || undefined;
};
