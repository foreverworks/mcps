import { formatDecimal, sum, toDecimal } from "@foreverworks/mcp-kit";

import { fail, inputError } from "../errors.js";
import type { XmlElement } from "./xml.js";

/**
 * What a declaration's XML says, read the same way for every form: the
 * period, the taxpayer and what it declares payable. Amounts are whole lei
 * (the forms' N(15)), kept as text and summed exactly. Pure.
 */

/** What a return declares payable, in whole lei. */
export type Payable = {
  /** The amount to pay. */
  readonly total: string;
  /** What it is made of, per obligation code, without zeros. */
  readonly items: readonly { readonly code: string; readonly lei: string }[];
  /** What the return shows to refund or carry forward, when it shows any (D100's suma_rest, D300's negative VAT balance). */
  readonly refundable?: string;
  /** D300: whether the return asks for that refund. */
  readonly refundAsked?: boolean;
};

export type Reading = {
  readonly year: number;
  readonly month: number;
  readonly cif: string | undefined;
  /** The taxpayer's name, as the return gives it. */
  readonly name: string | undefined;
  readonly rectifying: boolean;
  /** D300's tip_decont: how often the taxpayer files it. */
  readonly cadence?: "monthly" | "quarterly" | "half-yearly" | "yearly";
  readonly payable: Payable | undefined;
};

/** An attribute that must be an integer in a range, by the form's own rule. */
export const integerOf = (el: XmlElement, name: string, form: string, min: number, max: number): number => {
  const text = el.attributes[name];
  const value = Number(text);
  return text !== undefined && /^\d+$/.test(text.trim()) && value >= min && value <= max
    ? value
    : fail(inputError(`the ${form}'s ${name} on <${el.name}> is "${text ?? ""}", not a number from ${min} to ${max}`));
};

/** An amount in whole lei; absent is 0, as in the forms' own rules for optional rows. */
export const leiOf = (el: XmlElement, name: string, form: string): string => {
  const text = (el.attributes[name] ?? "0").trim();
  return /^\d{1,15}$/.test(text) ? String(BigInt(text)) : fail(inputError(`the ${form}'s ${name} on <${el.name}> is "${text}", not a whole number of lei`));
};

export const totalOf = (amounts: readonly string[]): string => formatDecimal(sum(amounts.map(toDecimal)));

/** Amounts per code, codes merged in the order they first appear, zeros left out. */
export const perCode = (rows: readonly { readonly code: string; readonly lei: string }[]): Payable["items"] => {
  const codes = [...new Set(rows.map((r) => r.code))];
  return codes.map((code) => ({ code, lei: totalOf(rows.filter((r) => r.code === code).map((r) => r.lei)) })).filter((i) => i.lei !== "0");
};

const MAX_ITEMS = 4;

/** "to pay 1850 lei (121: 1250, 150: 600)", at most four codes, then how many more. */
export const obligationsText = (p: Payable): string => {
  const shown = p.items.slice(0, MAX_ITEMS).map((i) => `${i.code}: ${i.lei}`);
  const more = p.items.length > MAX_ITEMS ? `, +${p.items.length - MAX_ITEMS} more` : "";
  const pay = p.total === "0" ? "nothing to pay" : `to pay ${p.total} lei${shown.length > 0 ? ` (${shown.join(", ")}${more})` : ""}`;
  return p.refundable === undefined || p.refundable === "0" ? pay : `${pay}, to refund ${p.refundable} lei`;
};

/** A name as short as a confirmation line can carry. */
export const shortName = (name: string | undefined): string | undefined => {
  const trimmed = name?.replace(/\s+/g, " ").trim();
  if (trimmed === undefined || trimmed === "") return undefined;
  return trimmed.length > 40 ? `${trimmed.slice(0, 37)}...` : trimmed;
};
