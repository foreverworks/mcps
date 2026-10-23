import { type Detail } from "./detail.js";
import { decodePartData, type MimePart, walkParts } from "./mime.js";

/** Bodies reach the model verbatim; one newsletter must not spend the context. */
export const MAX_BODY_CHARS = 40_000;

export type BodySource = "plain" | "html" | "html-converted" | "none";

export type Body = {
  readonly body: string | undefined;
  readonly bodySource: BodySource;
};

/** Injected so this module stays pure and testable without an HTML library. */
export type HtmlToText = (html: string) => string;

const truncate = (text: string): string =>
  text.length <= MAX_BODY_CHARS
    ? text
    : `${text.slice(0, MAX_BODY_CHARS)}\n\n[truncated at ${MAX_BODY_CHARS} chars]`;

const firstOfType = (payload: MimePart, mimeType: string): string | undefined => {
  for (const part of walkParts(payload)) {
    if (part.mimeType !== mimeType) continue;
    const data = part.body?.data;
    const decoded = data == null ? undefined : decodePartData(data);
    if (decoded !== undefined) return decoded;
  }
  return undefined;
};

const select = (
  plain: string | undefined,
  html: string | undefined,
  detail: Detail,
  htmlToText: HtmlToText,
): readonly [string | undefined, BodySource] => {
  if (detail === "raw_html") return html !== undefined ? [html, "html"] : [plain, plain ? "plain" : "none"];
  if (plain !== undefined) return [plain, "plain"];
  // The fallback is the point: mail that ships only text/html used to come back
  // as raw markup, which is unreadable and several times larger than its words.
  if (html !== undefined) return [htmlToText(html), "html-converted"];
  return [undefined, "none"];
};

export const bodyOf = (payload: MimePart, detail: Detail, htmlToText: HtmlToText): Body => {
  const [chosen, bodySource] = select(
    firstOfType(payload, "text/plain"),
    firstOfType(payload, "text/html"),
    detail,
    htmlToText,
  );
  return { body: chosen === undefined ? undefined : truncate(chosen), bodySource };
};
