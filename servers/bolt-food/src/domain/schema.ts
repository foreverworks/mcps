/**
 * The Bolt Food payloads, as far as this server reads them.
 *
 * Every field is optional because none of it is a published contract: these are
 * the JSON shapes the web app (FW.1.117) receives, captured 2026-09-10. A field
 * that disappears must degrade a receipt, not crash it.
 *
 * Deliberately NOT modelled: delivery_address, delivery_note, courier and the
 * lat/lng pair. They are in the payload and they are the customer's home
 * address and phone number; a receipt has no use for them, so no tool can leak
 * them.
 */

export type Localized = { readonly value?: string };

export type RawPrice = {
  readonly value?: number;
  readonly currency?: string;
  readonly discount_percent?: number;
  readonly original_price?: { readonly value?: number } | null;
};

/** One row of GET /deliveryClient/getOrderHistory. */
export type RawSummary = {
  readonly order_id: number;
  readonly city_id: number;
  readonly order_created_timestamp: number;
  readonly order_final_state_transition_timestamp?: number | null;
  readonly order_state: string;
  readonly provider_id?: number;
  readonly provider_name?: Localized;
  readonly price?: RawPrice | null;
};

export type RawOption = {
  readonly name?: Localized;
  readonly amount?: number;
  readonly total_item_price?: RawPrice | null;
};

export type RawAdjustment = {
  readonly is_strike_through_adjusted_item?: boolean;
  readonly original?: { readonly text?: { readonly text?: Localized } | null } | null;
};

export type RawItem = {
  readonly name?: Localized;
  readonly menu_item_id?: number;
  readonly amount?: number;
  readonly user_note?: string | null;
  readonly unit_item_price?: RawPrice | null;
  readonly total_item_price?: RawPrice | null;
  readonly options?: readonly RawOption[];
  readonly adjustment?: RawAdjustment | null;
};

export type RawComponent = {
  readonly type?: string;
  readonly data?: { readonly name?: Localized; readonly amount?: RawPrice | null };
};

export type RawPayment = {
  readonly type?: string;
  readonly title?: Localized;
  readonly amount?: RawPrice | null;
};

/** The body of POST /deliveryClient/v2/getOrderDetails. */
export type RawDetails = {
  readonly order_id?: number;
  readonly order_reference_id?: string;
  readonly order_state?: string;
  readonly order_refund_state?: string | null;
  readonly refund_amount?: RawPrice | null;
  readonly provider_name?: Localized;
  readonly order_created_timestamp?: number;
  readonly total_price?: RawPrice | null;
  readonly user_baskets?: readonly { readonly items?: readonly RawItem[] }[];
  readonly total_price_components?: readonly RawComponent[];
  readonly payment_methods?: readonly RawPayment[];
  readonly info_boxes?: readonly { readonly text?: Localized }[];
};

/** Every Bolt answer, whatever the HTTP status said. `code` 0 is success; 1005 is throttling. */
export type RawEnvelope<T> = { readonly code?: number; readonly message?: string; readonly data?: T };

/** `data` of POST /profile/eater/auth/getAccessToken. */
export type RawAccess = { readonly access_token?: string; readonly expires_timestamp?: number };

/** `data` of GET /deliveryClient/getOrderHistory: one page, and the token of the next (older) one. */
export type RawHistoryPage = { readonly orders?: readonly RawSummary[]; readonly next_page_token?: string | null };
