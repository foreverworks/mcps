import type { RawAspsp } from "./schema.js";

/**
 * The ASPSP list is long and mostly noise for the one decision it informs:
 * which `name` to hand to start_auth, and whether the bank supports the PSU
 * type you need.
 */
export type Bank = {
  readonly name: string;
  readonly country: string;
  readonly psuTypes: readonly string[];
  readonly authApproaches: readonly string[];
  readonly maxConsentDays: number;
};

export const bank = (raw: RawAspsp): Bank => ({
  name: raw.name,
  country: raw.country,
  psuTypes: raw.psu_types,
  authApproaches: [...new Set(raw.auth_methods.map((m) => m.approach))],
  // Seconds on the wire; whole days are what a human compares with 180.
  maxConsentDays: Math.floor(raw.maximum_consent_validity / 86_400),
});
