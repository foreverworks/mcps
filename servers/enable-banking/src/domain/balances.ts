import type { RawBalance } from "./schema.js";
import { amountText } from "./transactions.js";

/**
 * A balance as the bank reports it. A bank sends several per account, each
 * under a PSD2 balance type (ISO 20022 `BalanceType12Code`); the code is kept
 * as sent and its meaning spelled out beside it, so a reader need not know
 * that `CLBD` is the booked balance and `ITAV` what can be spent now.
 *
 * The amount is the bank's own exact decimal string, already signed by the
 * bank (an overdrawn account is a negative figure). Nothing here turns it into
 * a number (see transactions.ts, Amounts).
 */
export type Balance = {
  readonly name: string | undefined;
  /** The PSD2 code as the bank sent it. */
  readonly type: string;
  readonly typeMeaning: string | undefined;
  /** Decimal STRING, signed by the bank. Never a number. */
  readonly amount: string | undefined;
  /** Present only when the figure could NOT be taken at face value. */
  readonly amountWarning?: string | undefined;
  readonly currency: string;
  readonly lastChange: string | undefined;
  readonly referenceDate: string | undefined;
  readonly lastCommittedTransaction: string | undefined;
};

/** ISO 20022 balance types, as Enable Banking enumerates them. */
export const BALANCE_TYPES: Readonly<Record<string, string>> = {
  CLAV: "closing available",
  CLBD: "closing booked",
  FWAV: "forward available",
  INFO: "information only",
  ITAV: "interim available",
  ITBD: "interim booked",
  OPAV: "opening available",
  OPBD: "opening booked",
  OTHR: "other",
  PRCD: "previously closed booked",
  VALU: "value-date",
  XPCD: "expected",
};

const orUndefined = (value: string | null | undefined): string | undefined => (value === null || value === undefined || value === "" ? undefined : value);

/** One balance entry, mapped. `balance_amount`, `balance_type` and `name` are required by the schema. */
export const balance = (raw: RawBalance): Balance => {
  const amount = amountText(raw.balance_amount.amount);
  const type = String(raw.balance_type);
  return {
    name: orUndefined(raw.name),
    type,
    typeMeaning: BALANCE_TYPES[type],
    amount: amount?.value,
    ...(amount !== undefined && !amount.ok ? { amountWarning: amount.reason } : {}),
    currency: raw.balance_amount.currency,
    lastChange: orUndefined(raw.last_change_date_time),
    referenceDate: orUndefined(raw.reference_date),
    lastCommittedTransaction: orUndefined(raw.last_committed_transaction),
  };
};
