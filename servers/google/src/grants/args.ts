import { z } from "zod";

import { ALL_ACCOUNTS } from "../domain/accounts.js";

/**
 * The account inputs of the products that hold one grant per account (Tasks,
 * Contacts, Meet), worded once so they cannot drift between them.
 */
export const readAccountArg = (fallback: "all" | "first" = "all") =>
  z
    .string()
    .default(fallback === "all" ? ALL_ACCOUNTS : "")
    .describe(
      fallback === "all"
        ? `Which account: a label from list_accounts, or "${ALL_ACCOUNTS}" for every account at once (the default).`
        : "Which account: a label from list_accounts; empty means the first one with a grant.",
    );

/** A write never falls back to a default account: the caller names one. */
export const writeAccountArg = () =>
  z
    .string()
    .min(1)
    .refine((v) => v.trim() !== ALL_ACCOUNTS, `a write takes one account, not "${ALL_ACCOUNTS}"`)
    .describe("Which account this writes to: a label from list_accounts. Required; writes have no default.");
