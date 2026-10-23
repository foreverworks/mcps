/**
 * Porkbun's money is integer US cents (`cost_cents: 1108` is $11.08). These
 * turn it into the dollars a user reads without ever dividing: the digits
 * are moved, so no amount passes through a float.
 */

/** 1108 -> "11.08", 5 -> "0.05", -250 -> "-2.50": the exact decimal string. Not a whole number of cents: said so, never rounded. */
export const decimalOf = (cents: number): string => {
  if (!Number.isSafeInteger(cents)) return `${String(cents)} (not a whole number of cents)`;
  const digits = String(Math.abs(cents)).padStart(3, "0");
  return `${cents < 0 ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`;
};

/** 1108 -> "$11.08", 5 -> "$0.05", -250 -> "-$2.50". Not a whole number of cents: said so, never rounded. */
export const usd = (cents: number): string => {
  const exact = decimalOf(cents);
  if (!Number.isSafeInteger(cents)) return exact;
  return exact.startsWith("-") ? `-$${exact.slice(1)}` : `$${exact}`;
};

/**
 * A money argument, which the vendor accepts under its `_cents` name or a
 * legacy alias in the same unit, and refuses outright when the two disagree.
 */
export type CentsArg =
  | { readonly kind: "cents"; readonly cents: number }
  | { readonly kind: "absent" }
  | { readonly kind: "conflict" };

export const centsArg = (args: Readonly<Record<string, unknown>>, name: string, legacy: string): CentsArg => {
  const current = args[name];
  const old = args[legacy];
  if (current !== undefined && old !== undefined && current !== old) return { kind: "conflict" };
  const value = current ?? old;
  return typeof value === "number" ? { kind: "cents", cents: value } : { kind: "absent" };
};
