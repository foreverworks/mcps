import { z } from "zod";

/** Input fields more than one tool shares, described once. */

/** A date argument, described in the zone the server reads dates in (its `<PREFIX>_TIME_ZONE`). */
export const localDate = (timeZone: string, what: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe(`${what}, YYYY-MM-DD, as a calendar date in ${timeZone} (inclusive).`);

/** `description` says what a headline holds in this app. */
export const detailField = (description: string) => z.enum(["headline", "full"]).default("headline").describe(description);

/** The states an app's receipts take, and what they mean to a caller. */
export type StateCopy = { readonly values: readonly [string, ...string[]]; readonly description: string };

export const stateField = ({ values, description }: StateCopy) => z.enum(values).optional().describe(description);
