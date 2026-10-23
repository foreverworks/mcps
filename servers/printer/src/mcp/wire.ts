/**
 * Results go out with snake_case keys, as tool arguments come in; the domain
 * keeps TypeScript's camelCase. Keys only: every key in these results is a
 * field name, never data (no map keyed by a name or an id).
 */
const snake = (key: string): string => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

export const wire = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(wire);
  if (value === null || typeof value !== "object" || value instanceof Uint8Array) return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [snake(k), wire(v)]));
};
