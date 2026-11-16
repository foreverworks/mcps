import type { JsonNumber } from "../domain/purchase.js";
import { drift, fail } from "../domain/errors.js";

/**
 * JSON with exact amounts. An order carries the price eToll quoted; written
 * through JSON.stringify it would have to be a float first. Here a
 * `{jsonNumber: "150.00"}` is written as the digits `150.00`, which is a
 * JSON number eToll reads like any other, and the amount never was a float.
 */
const NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?$/;

const isJsonNumber = (v: unknown): v is JsonNumber =>
  typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 1 && typeof (v as { jsonNumber?: unknown }).jsonNumber === "string";

export const jsonText = (value: unknown): string => {
  if (isJsonNumber(value)) return NUMBER.test(value.jsonNumber) ? value.jsonNumber : fail(drift(`"${value.jsonNumber}" is not an amount`));
  if (Array.isArray(value)) return `[${value.map((v: unknown) => (v === undefined ? "null" : jsonText(v))).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const fields = Object.entries(value).filter(([, v]) => v !== undefined);
    return `{${fields.map(([k, v]) => `${JSON.stringify(k)}:${jsonText(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
};
