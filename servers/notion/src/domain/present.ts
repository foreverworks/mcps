/**
 * The entries of a map whose values may be null, without the nulls. `Wire`
 * (the kit's) types every map value in Notion's answers as possibly null, as
 * answers really arrive; a property or a column that is null has nothing to
 * read, so it is skipped rather than guessed at.
 */
export const present = <T>(map: Readonly<Record<string, T | null>>): readonly (readonly [string, T])[] =>
  Object.entries(map).flatMap(([key, value]) => (value === null ? [] : [[key, value] as const]));
