/**
 * Words joined as a sentence lists them: "a", "a and b", "a, b and c", or
 * with the serial comma "a, b, and c". Each caller picks one style for its
 * text, so a list cut down to what is loaded (GOOGLE_TOOLSETS) reads like the
 * full one with items missing.
 */
export const listed = (items: readonly string[], conjunction: "and" | "or", serial = false): string => {
  if (items.length <= 2) return items.join(` ${conjunction} `);
  return `${items.slice(0, -1).join(", ")}${serial ? "," : ""} ${conjunction} ${items.at(-1) ?? ""}`;
};
