import { type Inline, LINE_BREAK, mergeInlines } from "../../blocks.js";

/**
 * Inline markdown to styled runs: **bold**, *italic* (and the underscore
 * forms), ~~strike~~, `code`, [links](url), <autolinks>, bare https:// URLs,
 * backslash escapes and hard line breaks.
 *
 * Not a CommonMark implementation. It covers what people and models write,
 * and the edge where it gives up is literal text, never a lost word: an
 * unmatched `**` stays two asterisks in the document.
 */

type Style = Omit<Inline, "text">;

const PUNCTUATION = /[!-/:-@[-`{-~]/;
const isSpace = (ch: string | undefined): boolean => ch === undefined || /\s/.test(ch);
const isWordChar = (ch: string | undefined): boolean => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

/** The length of the run of `ch` starting at `at`. */
const runLength = (s: string, at: number, ch: string): number => {
  let end = at;
  while (s[end] === ch) end += 1;
  return end - at;
};

const DELIMITERS: readonly { readonly mark: string; readonly style: Style }[] = [
  { mark: "***", style: { bold: true, italic: true } },
  { mark: "___", style: { bold: true, italic: true } },
  { mark: "**", style: { bold: true } },
  { mark: "__", style: { bold: true } },
  { mark: "~~", style: { strike: true } },
  { mark: "*", style: { italic: true } },
  { mark: "_", style: { italic: true } },
];

/**
 * Where the emphasis opened at `open` closes: the end of the first delimiter
 * run of the same character, at least as long, that follows a non-space. A
 * longer run closes with its LAST characters, so `**a *b***` nests the italic
 * inside the bold. Underscores do not open or close inside a word
 * (snake_case stays snake_case). Code spans are skipped over.
 */
const findCloser = (s: string, open: number, mark: string): number | undefined => {
  const ch = mark[0] as string;
  let j = open + mark.length;
  while (j < s.length) {
    if (s[j] === "\\") {
      j += 2;
      continue;
    }
    if (s[j] === "`") {
      const ticks = runLength(s, j, "`");
      const close = s.indexOf("`".repeat(ticks), j + ticks);
      j = close === -1 ? j + ticks : close + ticks;
      continue;
    }
    if (s[j] !== ch) {
      j += 1;
      continue;
    }
    const length = runLength(s, j, ch);
    const end = j + length;
    const rightFlanking = !isSpace(s[j - 1]);
    const intraword = ch === "_" && isWordChar(s[end]);
    if (length >= mark.length && rightFlanking && !intraword && j > open + mark.length) {
      return end - mark.length;
    }
    j = end;
  }
  return undefined;
};

type LinkMatch = { readonly text: string; readonly url: string; readonly end: number };

/** `[text](url)` or `[text](<url> "title")` starting at `at`, which is the `[`. */
const matchLink = (s: string, at: number): LinkMatch | undefined => {
  let depth = 0;
  let close = -1;
  for (let j = at; j < s.length; j += 1) {
    if (s[j] === "\\") {
      j += 1;
      continue;
    }
    if (s[j] === "[") depth += 1;
    if (s[j] === "]" && --depth === 0) {
      close = j;
      break;
    }
  }
  if (close === -1 || s[close + 1] !== "(") return undefined;

  let j = close + 2;
  while (s[j] === " ") j += 1;
  let url = "";
  if (s[j] === "<") {
    const end = s.indexOf(">", j);
    if (end === -1) return undefined;
    url = s.slice(j + 1, end);
    j = end + 1;
  } else {
    let parens = 0;
    const start = j;
    while (j < s.length && !(s[j] === ")" && parens === 0) && !/\s/.test(s[j] as string)) {
      if (s[j] === "\\") j += 1;
      else if (s[j] === "(") parens += 1;
      else if (s[j] === ")") parens -= 1;
      j += 1;
    }
    url = s.slice(start, j).replace(/\\(.)/g, "$1");
  }
  // An optional "title", which Docs has nowhere to put.
  const rest = /^\s*(?:"[^"]*"|'[^']*')?\s*\)/.exec(s.slice(j));
  if (!rest) return undefined;
  return { text: s.slice(at + 1, close), url, end: j + rest[0].length };
};

const AUTOLINK = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/;
const BARE_URL = /^https?:\/\/[^\s<>]*[^\s<>.,;:!?'")\]]/;

const parseStyled = (s: string, style: Style): readonly Inline[] => {
  const out: Inline[] = [];
  let buffer = "";
  const flush = (): void => {
    if (buffer) out.push({ text: buffer, ...style });
    buffer = "";
  };

  let i = 0;
  while (i < s.length) {
    const ch = s[i] as string;
    const rest = s.slice(i);

    if (ch === "\\" && s[i + 1] === "\n") {
      buffer += LINE_BREAK;
      i += 2;
      continue;
    }
    if (ch === "\\" && s[i + 1] !== undefined && PUNCTUATION.test(s[i + 1] as string)) {
      buffer += s[i + 1];
      i += 2;
      continue;
    }
    if (ch === "`") {
      const ticks = runLength(s, i, "`");
      const close = s.indexOf("`".repeat(ticks), i + ticks);
      if (close !== -1 && runLength(s, close, "`") === ticks) {
        flush();
        const raw = s.slice(i + ticks, close).replace(/\n/g, " ");
        const code = raw.length > 2 && raw.startsWith(" ") && raw.endsWith(" ") && raw.trim() ? raw.slice(1, -1) : raw;
        out.push({ text: code, ...style, code: true });
        i = close + ticks;
        continue;
      }
      buffer += "`".repeat(ticks);
      i += ticks;
      continue;
    }
    if (ch === "[" || (ch === "!" && s[i + 1] === "[")) {
      // An image becomes a link to it: inserting an image needs a URL Google can fetch, which this cannot promise.
      const link = matchLink(s, ch === "!" ? i + 1 : i);
      if (link) {
        flush();
        out.push(...parseStyled(link.text, { ...style, link: link.url }));
        i = link.end;
        continue;
      }
    }
    const auto = AUTOLINK.exec(rest);
    if (auto) {
      flush();
      out.push({ text: auto[1] as string, ...style, link: auto[1] as string });
      i += auto[0].length;
      continue;
    }
    const bare = style.link === undefined && !isWordChar(s[i - 1]) ? BARE_URL.exec(rest) : null;
    if (bare) {
      flush();
      out.push({ text: bare[0], ...style, link: bare[0] });
      i += bare[0].length;
      continue;
    }
    if (ch === "*" || ch === "_" || ch === "~") {
      const opened = DELIMITERS.filter((d) => rest.startsWith(d.mark))
        .filter((d) => !isSpace(s[i + d.mark.length]))
        .filter((d) => d.mark[0] !== "_" || !isWordChar(s[i - 1]))
        .map((d) => ({ d, close: findCloser(s, i, d.mark) }))
        .find((c) => c.close !== undefined);
      if (opened && opened.close !== undefined) {
        flush();
        out.push(...parseStyled(s.slice(i + opened.d.mark.length, opened.close), { ...style, ...opened.d.style }));
        i = opened.close + opened.d.mark.length;
        continue;
      }
      const run = runLength(s, i, ch);
      buffer += ch.repeat(run);
      i += run;
      continue;
    }
    buffer += ch;
    i += 1;
  }
  flush();
  return out;
};

/** One paragraph's worth of inline markdown, lines already joined. */
export const parseInline = (text: string): readonly Inline[] => mergeInlines(parseStyled(text, {}));
