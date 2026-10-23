import { z } from "zod";

import { ALL_ACCOUNTS } from "../../infra/accounts.js";

/**
 * The one input every tool shares, so its wording cannot drift between them.
 * `fallback` is what an empty string means, stated in the description rather
 * than left for the caller to discover by trying it.
 */
export const accountArg = (fallback: "default" | "all" = "default") =>
  z
    .string()
    .default(fallback === "all" ? ALL_ACCOUNTS : "")
    .describe(
      fallback === "all"
        ? `Which registered mailbox. A label from list_accounts, or "${ALL_ACCOUNTS}" for every mailbox at once (the default here).`
        : "Which registered mailbox: a label from list_accounts; empty means the default account.",
    );

/**
 * The same input for a tool that WRITES, with no default. Sending from the
 * wrong mailbox is an outward-facing mistake with the wrong identity on it, so
 * a write never falls back to the default account: the caller names one.
 */
export const writeAccountArg = () =>
  z
    .string()
    .min(1)
    .refine((v) => v.trim() !== ALL_ACCOUNTS, `a write takes one account, not "${ALL_ACCOUNTS}"`)
    .describe("Which mailbox this writes to or sends from: a label from list_accounts. Required; there is no default for writes.");
