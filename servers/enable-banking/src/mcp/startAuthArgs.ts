import { z } from "zod";

import type { PsuType } from "../domain/schema.js";

const PSU_TYPES = ["business", "personal"] as const satisfies readonly PsuType[];

/**
 * start_auth's arguments: ONE definition, which the tool registers and the
 * policy parses to write the line a user confirms, so the line describes
 * exactly the call that will run. The bank, its country and the account type
 * have no defaults: a consent is asked of the bank the caller names.
 */
export const START_AUTH_INPUT = {
  aspsp_name: z.string().trim().min(1).describe("The bank: the name field from list_aspsps, exactly as spelled there."),
  aspsp_country: z.string().regex(/^[A-Za-z]{2}$/, "a two-letter country code").describe("The bank's two-letter country code."),
  psu_type: z.enum(PSU_TYPES).describe("Whose accounts: business or personal (list_aspsps says which the bank offers)."),
  state: z.string().default("enable-banking").describe("Echoed back on the redirect; useful to tell flows apart."),
};

export const startAuthArgs = z.object(START_AUTH_INPUT);
