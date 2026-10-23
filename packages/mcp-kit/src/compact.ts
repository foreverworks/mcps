/**
 * An object without its `undefined` fields, typed as such.
 *
 * `exactOptionalPropertyTypes` is on in every workspace, so an optional field
 * is either absent or a value, never `undefined`. Parsed input and optional
 * wire fields arrive as `T | undefined`; this is where they become "absent",
 * instead of a conditional spread per field. A key whose type admits
 * `undefined` comes out optional; every other key stays required.
 */
type RequiredKeys<T> = { [K in keyof T]-?: undefined extends T[K] ? never : K }[keyof T];
type OptionalKeys<T> = { [K in keyof T]-?: undefined extends T[K] ? K : never }[keyof T];

export type Compact<T> = { readonly [K in RequiredKeys<T>]: T[K] } & {
  readonly [K in OptionalKeys<T>]?: Exclude<T[K], undefined>;
};

export const compact = <T extends object>(value: T): Compact<T> =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Compact<T>;
