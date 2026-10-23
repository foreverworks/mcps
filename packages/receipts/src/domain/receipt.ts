/**
 * What every receipt has, whichever app it came from.
 *
 * Each app maps its own payload to its own receipt (bolt-food's names the
 * restaurant `provider` and splits the card from Bolt Balance; glovo's names
 * the `store` and splits the card from Glovo credits and cash), and those
 * shapes are what the tools return, so they stay the app's. The shared rules
 * read only this much of them: which order, in what state, on which local date,
 * in which currency, what the CARD was charged, and which lines were kept.
 */
export type ReceiptCore = {
  readonly orderId: number;
  readonly state: string;
  /** Absent when the app gave the order no time at all. */
  readonly localDate?: string | undefined;
  readonly currency?: string | undefined;
  /**
   * What was taken for the order, per payment method, each a decimal string:
   * every key is one leg (the card, the app's balance or credits, cash), so
   * together they are what the order cost. `card` is the amount on the bank
   * statement; absent when it cannot be known.
   */
  readonly charged: { readonly card?: string | undefined } & Readonly<Record<string, string | undefined>>;
  readonly items: readonly { readonly adjustment?: string | undefined }[];
};

/** The one state that was paid for and received. Both apps' receipts use this word. */
export const DELIVERED = "delivered";

/** A line a grocery picker dropped: it was never paid for. */
export const REMOVED = "removed";

/** The lines the customer actually received. */
export const keptItemCount = (receipt: ReceiptCore): number => receipt.items.filter((i) => i.adjustment !== REMOVED).length;
