import type { Detail } from "../receiptApp.js";

/** The receipt as the caller asked for it: whole, or its headline. */
export const atDetail =
  <R, H>(headline: (receipt: R) => H, detail: Detail) =>
  (receipt: R): R | H =>
    detail === "full" ? receipt : headline(receipt);
