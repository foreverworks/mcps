import { fail, inputError } from "./errors.js";

/**
 * Notion ids, from whatever an agent or a user has in hand: the dashed UUID
 * the API answers with, the 32 bare hex digits of a URL, or the URL itself.
 *
 * A Notion URL puts the id at the end of its last path segment, after the
 * title's slug (`/Reading-List-0123abcd...`), or alone (`/p/0123abcd...`). When
 * a page is open on top of a database, the page is in `?p=`, and that is the
 * thing the URL is about. `#<hex>` names a block inside the page and is not a
 * page id, so it is ignored, except where a block is what is asked for
 * (toBlockId).
 */

const DASHED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BARE = /^[0-9a-f]{32}$/i;
const TRAILING = /([0-9a-f]{32})$/i;
const FRAGMENT = /#([0-9a-f]{32})$/i;

const dashed = (hex: string): string => {
  const h = hex.toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

const fromUrl = (raw: string): string | undefined => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (!/(^|\.)notion\.(so|site|com)$/i.test(url.hostname)) return undefined;
  const peek = url.searchParams.get("p")?.replace(/-/g, "");
  if (peek !== undefined && BARE.test(peek)) return dashed(peek);
  const last = url.pathname.split("/").filter((s) => s.length > 0).pop() ?? "";
  const hex = TRAILING.exec(last.replace(/-/g, ""))?.[1];
  return hex === undefined ? undefined : dashed(hex);
};

/** The canonical dashed, lower-case id, or undefined when `input` holds none. */
export const parseId = (input: string): string | undefined => {
  const raw = input.trim();
  if (DASHED.test(raw)) return raw.toLowerCase();
  if (BARE.test(raw)) return dashed(raw);
  return fromUrl(raw);
};

/** Like parseId, for an argument: a value that holds no id is the caller's mistake, said as such. */
export const toId = (input: string, what = "id"): string =>
  parseId(input) ?? fail(inputError(`${what} "${input}" is not a Notion id or a Notion URL (notion.so, notion.site)`));

/**
 * A block's id: like toId, but in a Notion URL the `#<hex>` fragment, the
 * block inside the page (a citation in an AI summary links to one), wins.
 */
export const toBlockId = (input: string, what = "block"): string => {
  const raw = input.trim();
  const fragment = FRAGMENT.exec(raw)?.[1];
  return fragment !== undefined && fromUrl(raw) !== undefined ? dashed(fragment) : toId(raw, what);
};

/** The shortest URL that opens an object in Notion, whichever workspace it is in. */
export const urlOf = (id: string): string => `https://www.notion.so/${id.replace(/-/g, "")}`;
