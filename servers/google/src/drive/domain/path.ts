import { fail, inputError } from "./errors.js";

/** Drive's own name for the top of My Drive. Every path resolve starts here. */
export const ROOT_ID = "root";

/**
 * A Drive file id, checked before it is sent: Drive's ids are letters, digits,
 * `-` and `_`, so anything else (a path, a pasted link, a stray quote) fails
 * here, naming what was given, instead of travelling on as a query.
 */
export const driveId = (id: string, what = "file id"): string =>
  /^[A-Za-z0-9_-]+$/.test(id) ? id : fail(inputError(`"${id.slice(0, 80)}" is not a Drive ${what} (letters, digits, - and _)`));

/**
 * A Drive path is a list of names, not a string.
 *
 * Splitting once, here, is what keeps the rest of the server from re-deciding
 * whether a leading slash matters or a trailing one means "the folder". Empty
 * segments collapse, so "/Accounting//Invoices/" and "Accounting/Invoices"
 * are the same path, which is what anyone typing one expects.
 */
export const splitPath = (path: string): readonly string[] =>
  path
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

export const joinPath = (segments: readonly string[]): string => segments.join("/");

/** The root is the only path with no segments; "" and "/" both mean it. */
export const isRootPath = (path: string): boolean => splitPath(path).length === 0;

export const basename = (path: string): string => {
  const segments = splitPath(path);
  const last = segments[segments.length - 1];
  if (last === undefined) return fail(inputError("the root folder has no name"));
  return last;
};

export const dirname = (path: string): string => joinPath(splitPath(path).slice(0, -1));

/**
 * Escape a name for Drive's `q` grammar, where a literal is single-quoted.
 *
 * Only backslash and single quote are special, and both are escaped with a
 * backslash. Getting this wrong does not error: it silently changes the query,
 * which is how a file named "Don't" would come back as "no such file".
 */
export const quoteForQuery = (literal: string): string => `'${literal.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/**
 * The same name, spelled every way Unicode allows.
 *
 * Drive's `name =` is an exact match on the string it stored, and it stores
 * whatever the client that created the file sent. macOS clients commonly send
 * a name decomposed: a folder with a diacritic is then stored
 * **NFD** ("Café" as e + U+0301), while a path typed anywhere else arrives
 * NFC (U+00E9). Matching one against the
 * other silently returns nothing, which surfaces as "no such folder" for a
 * folder sitting right there.
 *
 * So a lookup asks for both forms in one query rather than picking a side.
 * Deduplicated, because for a name without diacritics the two are the same
 * string and `name = 'x' or name = 'x'` is just noise in the query.
 */
export const nameVariants = (name: string): readonly string[] => [
  ...new Set([name, name.normalize("NFC"), name.normalize("NFD")]),
];
