/**
 * What the use cases need, stated as functions rather than objects with
 * behaviour. Everything here is an interface the infra layer satisfies; nothing
 * in app/ or domain/ ever imports from infra/. The ports every receipts server
 * shares (the store, the files, the paths) are packages/receipts'.
 */
import type { BaseDeps, OrderStore as StoreOf } from "@foreverworks/receipts/app";

import type { RawDetails, RawSummary } from "../domain/schema.js";
import type { TokenFacts } from "../domain/token.js";

export type BoltPort = {
  /** Every order in the account, newest first. Pagination is the adapter's business. */
  readonly history: () => Promise<readonly RawSummary[]>;
  readonly orderDetails: (orderId: number, cityId: number) => Promise<RawDetails>;
  /** Mints a fresh access token and reports when it expires. Proves the refresh token is alive. */
  readonly probe: () => Promise<{ readonly accessExpiresAt: number }>;
};

/** Bolt order details that have stopped changing, kept across processes. */
export type OrderStore = StoreOf<RawDetails>;

export type Deps = BaseDeps<RawDetails, TokenFacts> & { readonly bolt: BoltPort };
