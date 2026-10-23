/**
 * The rules every delivery-app receipts server follows the same way: money in
 * minor units, local dates in a configured zone, the range cap, the card-row
 * join, the item ranking, the order statistics, and the failures they share. Pure: no I/O, and nothing here names an
 * app's endpoint or field.
 */
export { addDays, daysBetween, isIsoDate, localMoment, utcDate, type LocalMoment } from "./dates.js";
export { commonRemedy, configError, fail, inputError, isCommon, joinErrors, notFound, type CommonError } from "./errors.js";
export { SETTLE_DAYS, settledSince } from "./freshness.js";
export { rankItemsBy, toCsv, type RankableRow, type RankSpec } from "./items.js";
export { matchCharges, payableOrder, WINDOW, type Charge, type Dated, type MatchResult, type Pair, type PayableOrder } from "./matching.js";
export { currencyOf, formatMinor, parseBankAmount } from "./money.js";
export { inRange, MAX_RECEIPT_DAYS, parseRange, type DateRange } from "./range.js";
export { DELIVERED, keptItemCount, REMOVED, type ReceiptCore } from "./receipt.js";
export { orderStats, type StatLine } from "./stats.js";
export { containsIgnoringCase } from "./text.js";
export { jsonObject, jwtClaims } from "./token.js";
