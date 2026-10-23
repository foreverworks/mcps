/**
 * Words joined as a sentence lists them: "a", "a and b", "a, b and c", or
 * with the serial comma "a, b, and c". A text that lists only what is loaded
 * (GOOGLE_TOOLSETS) keeps whichever it always used, so with everything loaded
 * it reads exactly as it did before toolsets existed.
 */
export const listed = (items: readonly string[], conjunction: "and" | "or", serial = false): string => {
  if (items.length <= 2) return items.join(` ${conjunction} `);
  return `${items.slice(0, -1).join(", ")}${serial ? "," : ""} ${conjunction} ${items.at(-1) ?? ""}`;
};
