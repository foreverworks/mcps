/**
 * PSD2 transaction statuses, which the API only accepts as four-letter codes.
 *
 * Nobody remembers that "pending" is `PDNG`. Friendly names are mapped, codes
 * pass through, and an unknown value is upper-cased and sent anyway so a code
 * added to the API later does not need a release here to be usable.
 */
const FRIENDLY: Readonly<Record<string, string>> = {
  booked: "BOOK",
  book: "BOOK",
  pending: "PDNG",
  pdng: "PDNG",
  cancelled: "CNCL",
  canceled: "CNCL",
  cncl: "CNCL",
  hold: "HOLD",
  other: "OTHR",
  othr: "OTHR",
  rejected: "RJCT",
  rjct: "RJCT",
  scheduled: "SCHD",
  schd: "SCHD",
};

/** `undefined` means omit the filter, which is not the same as asking for booked. */
export const parseStatus = (value: string): string | undefined => {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  return FRIENDLY[trimmed.toLowerCase()] ?? trimmed.toUpperCase();
};
