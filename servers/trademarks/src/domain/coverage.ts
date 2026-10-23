import type { Office } from "./mark.js";

/**
 * The offices a caller may name that no source here can search, and why, in
 * the words a result carries. An office left out of a result would read as
 * "nothing found there"; for a name check that is the one wrong answer, so
 * each says it was not searched and where a human can look instead.
 */
export const UNCOVERED: Readonly<Partial<Record<Office, string>>> = {
  RO:
    "not searched: OSIM's own register (api.osim.ro:8443/tm-registry) sits behind a reCAPTCHA, and TMview, which carries it, " +
    "reserves its data against bots and automated access without EUIPO's written authorisation. Check by hand at " +
    "https://www.tmdn.org/tmview (office RO). An EU mark (EM) also covers Romania.",
  WO:
    "not searched: WIPO's Global Brand Database has no public API and its terms forbid automated queries. International " +
    "registrations designating the EU appear under EM, those designating the US under US (serial numbers 79xxxxxx); for " +
    "the rest, check by hand at https://branddb.wipo.int.",
};
