import { bearer, compact, makeTokenSource, memoryTokenStore } from "@foreverworks/mcp-kit";

import type { PlayPort } from "../app/ports.js";
import { asAppError, fail } from "../domain/errors.js";
import { GOOGLE_TOKEN_URI, type ServiceAccount } from "./credentials.js";
import { makeStoreHttp, type StoreHttpOptions } from "./http.js";
import { type ClockOptions, epochSeconds, signJwt } from "./jwt.js";
import { replyOf, reviewFrom } from "./play/mapping.js";
import type { PlayReview, ReplyAnswer, ReviewsList, TokenAnswer } from "./play/schema.js";

export const PLAY_API = "https://androidpublisher.googleapis.com/androidpublisher/v3";

const SCOPE = "https://www.googleapis.com/auth/androidpublisher";

/**
 * The Google Play Developer API with a service account. Its token comes from
 * Google's token endpoint for an assertion this server signs with the
 * account's key (RFC 7523, RS256); an hour long, kept in memory. The kit's
 * OAuth client has no assertion grant, so the one request is made here.
 */
export const makePlay = (account: () => Promise<ServiceAccount>, options: StoreHttpOptions & ClockOptions = {}, base = PLAY_API): PlayPort => {
  const now = options.nowEpoch ?? epochSeconds;
  const { nowEpoch: _now, ...httpOptions } = options;
  const tokenHttp = makeStoreHttp("play", undefined, httpOptions);
  const tokens = makeTokenSource({
    store: memoryTokenStore(),
    nowEpoch: now,
    mint: async () => {
      const sa = await account();
      const iat = now();
      const assertion = signJwt("RS256", { kid: sa.keyId }, { iss: sa.email, scope: SCOPE, aud: GOOGLE_TOKEN_URI, iat, exp: iat + 3600 }, sa.key);
      const answer = await tokenHttp<TokenAnswer>(GOOGLE_TOKEN_URI, {
        method: "POST",
        // Minting a token changes nothing, so it may be sent again.
        idempotent: true,
        form: { grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion },
      }).catch((thrown: unknown) => {
        const error = asAppError(thrown);
        // The endpoint answers a refused assertion (a deleted key, a disabled account) with a 400 invalid_grant.
        if (error?.kind === "input" || error?.kind === "not_found") return fail({ kind: "auth", store: "play", status: 400, message: `Google refused the service account's key: ${error.message}` });
        throw thrown;
      });
      const token = answer.access_token ?? fail({ kind: "drift", store: "play", message: "Google's token endpoint answered without an access token" });
      return { token, expiresAtEpoch: iat + (answer.expires_in ?? 3600) };
    },
  });
  const http = makeStoreHttp("play", bearer(tokens), httpOptions);
  const app = (packageName: string) => `${base}/applications/${encodeURIComponent(packageName)}`;

  return {
    check: async () => {
      await tokens.get();
      return { account: (await account()).email };
    },

    reviews: async (packageName, q) => {
      const doc = await http<ReviewsList>(`${app(packageName)}/reviews`, { query: compact({ maxResults: q.limit, token: q.cursor, translationLanguage: q.translateTo }) });
      return { items: (doc.reviews ?? []).map(reviewFrom), ...compact({ nextCursor: doc.tokenPagination?.nextPageToken || undefined }) };
    },

    review: async (packageName, reviewId) => reviewFrom(await http<PlayReview>(`${app(packageName)}/reviews/${encodeURIComponent(reviewId)}`)),

    reply: async (packageName, reviewId, text) => {
      const answer = await http<ReplyAnswer>(`${app(packageName)}/reviews/${encodeURIComponent(reviewId)}:reply`, { method: "POST", json: { replyText: text } });
      const result = answer.result;
      const reply = result === undefined ? null : replyOf(compact({ text: result.replyText, lastModified: result.lastEdited }));
      return reply ?? fail({ kind: "drift", store: "play", message: "Google answered a reply without its text" });
    },
  };
};
