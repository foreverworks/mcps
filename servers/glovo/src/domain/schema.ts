/**
 * The Glovo customer API payloads, as far as this server reads them.
 *
 * Every field is optional because none of it is a published contract: these are
 * the JSON shapes the web app (v1.2718.0, API version 14) receives, captured
 * in 2026. A field that disappears must degrade a receipt, not crash it.
 *
 * Deliberately NOT modelled: `points` (the pickup and delivery addresses, with
 * the courier's door notes in `details`), `courier` and `attachments`. They are
 * the customer's home address; a receipt has no use for them, so no tool can
 * leak them.
 */

/** One card of GET /v3/customer/orders-list. A display card: no date, no state, no payment. */
export type RawListRow = {
  readonly orderId: number;
  readonly orderUrn?: string;
  readonly content?: {
    readonly title?: string | null;
    readonly body?: readonly { readonly type?: string; readonly data?: string | null }[] | null;
  } | null;
  readonly footer?: { readonly left?: { readonly type?: string; readonly data?: string | null } | null } | null;
  readonly layoutType?: string;
};

export type RawListPage = {
  readonly pagination?: { readonly next?: { readonly offset?: number | string | null } | null } | null;
  readonly orders?: readonly RawListRow[];
};

export type RawPriceLine = {
  readonly type?: string;
  readonly description?: string | null;
  readonly amount?: string | null;
  readonly finalAmount?: string | null;
  readonly note?: string | null;
  readonly amountPrefix?: { readonly type?: string; readonly data?: { readonly text?: string | null } | null } | null;
};

export type RawPaymentLeg = {
  readonly type?: string;
  readonly provider?: string | null;
  readonly text?: string | null;
  /** Always null in every payload measured; the amount lives in `text`. */
  readonly amount?: unknown;
};

export type RawProduct = {
  readonly name?: string | null;
  /** "2x" */
  readonly quantity?: string | null;
  /** The LINE total, as display text. Null on cancelled orders. */
  readonly price?: string | null;
  readonly originalPrice?: string | null;
  readonly promotionDescription?: string | null;
  readonly customizationsDescription?: string | null;
  readonly notice?: string | null;
  readonly packaging?: string | null;
  readonly displayStyle?: string | null;
  readonly freeProduct?: boolean | null;
};

/** The body of GET /v3/customer/orders/{id}. */
export type RawDetails = {
  readonly id?: number;
  readonly code?: string | null;
  readonly storeId?: number | null;
  readonly storeName?: string | null;
  readonly vertical?: string | null;
  readonly refunded?: boolean | null;
  /** Always null in every payload measured: Glovo keeps no order-placed time. */
  readonly creationTime?: number | null;
  readonly scheduledTime?: number | null;
  readonly currentStatus?: { readonly type?: string | null; readonly creationTime?: number | null } | null;
  readonly headerNotice?: { readonly style?: string | null; readonly text?: string | null } | null;
  readonly pricingBreakdown?: { readonly lines?: readonly RawPriceLine[] | null } | null;
  readonly paymentMethodsBreakdown?: readonly RawPaymentLeg[] | null;
  readonly boughtProducts?: readonly RawProduct[] | null;
};

/** The body of POST /oauth/refresh. It also carries `refreshToken` (the same one) and `tokenType`, never read. */
export type RawRefresh = { readonly accessToken?: unknown; readonly expiresIn?: unknown };

/** Glovo's error body: a machine-readable code, sometimes a sentence. */
export type RawError = { readonly errorCode?: unknown; readonly errorDescription?: unknown };
