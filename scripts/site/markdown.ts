/**
 * A README as the site shows it: GitHub-flavoured Markdown rendered as GitHub
 * renders it (heading anchors with GitHub's ids, so a link to
 * `#from-a-clone` lands where it does on GitHub; `> [!NOTE]` alerts; tables;
 * the README's own HTML), with every link resolved for the page it lands on.
 * The install badges become plain links named by their alt text, so the site
 * reads the same without fetching an image from anyone.
 */
import { Marked, type Token, type Tokens } from "marked";

/** What a page needs to know to place a README's links: `resolve` turns a README's href into the page's. */
export type LinkResolver = (href: string, kind: "link" | "image") => string;

export type Heading = { readonly depth: number; readonly text: string; readonly id: string };

export type Rendered = {
  readonly html: string;
  /** The README's first-level heading as text (its title), when it has one; the page draws its own. */
  readonly title?: string;
  /** Every heading below the first level, in order, with its anchor. */
  readonly headings: readonly Heading[];
  /** Tags in the README's own HTML that GitHub strips, so a reader there never sees them: usually a placeholder meant for backticks. */
  readonly strays: readonly string[];
};

const ENTITIES: Readonly<Record<string, string>> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

/** Text for HTML: the five characters that could open markup or close an attribute. */
export const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/** Rendered inline HTML as the text a reader sees: tags dropped, entities read. */
export const textOf = (html: string): string => html.replace(/<[^>]*>/g, "").replace(/&(amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e] ?? e).trim();

/**
 * The id GitHub gives a heading: its text in lower case, without punctuation
 * but for hyphens and underscores, spaces as hyphens.
 */
export const githubSlug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");

/** A slug made unique on its page the way GitHub does it: the second "Setup" is `setup-1`. */
const uniqueSlugs = (): ((text: string) => string) => {
  const seen = new Map<string, number>();
  return (text) => {
    const base = githubSlug(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
};

const ALERTS: Readonly<Record<string, string>> = { NOTE: "Note", TIP: "Tip", IMPORTANT: "Important", WARNING: "Warning", CAUTION: "Caution" };

/** A shields.io badge (the README's install buttons). */
const isBadge = (token: Token | undefined): token is Tokens.Image => token?.type === "image" && token.href.startsWith("https://img.shields.io/");

/** A link whose only content is a badge. */
const badgeOf = (token: Token): Tokens.Image | undefined => {
  if (token.type !== "link") return undefined;
  const inner = (token as Tokens.Link).tokens;
  return inner.length === 1 && isBadge(inner[0]) ? inner[0] : undefined;
};

/** The tags GitHub keeps in a README's own HTML (its sanitizer's list, the parts READMEs use). */
const KEPT = new Set(
  "a abbr b blockquote br code dd del details div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img ins kbd li mark ol p picture pre q s samp small source span strong sub summary sup table tbody td th thead tr ul var".split(" "),
);

/** `src` and `href` attributes in a README's own HTML, resolved like Markdown links. */
const resolveAttributes = (html: string, resolve: LinkResolver): string =>
  html.replace(/\b(src|href)="([^"]*)"/g, (_, attribute: string, value: string) => `${attribute}="${escapeHtml(resolve(value, attribute === "src" ? "image" : "link"))}"`);

/**
 * A README rendered for one page. Its first-level heading is left out and
 * returned as `title`: the page draws its own header with the server's icon.
 */
export const renderReadme = (markdown: string, resolve: LinkResolver): Rendered => {
  const slug = uniqueSlugs();
  const headings: Heading[] = [];
  const strays: string[] = [];
  let title: string | undefined;
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const text = textOf(inner);
        if (depth === 1 && title === undefined) {
          title = text;
          return "";
        }
        const id = slug(text);
        headings.push({ depth, text, id });
        return `<h${depth} id="${escapeHtml(id)}"><a class="anchor" href="#${escapeHtml(id)}" aria-hidden="true" tabindex="-1">#</a>${inner}</h${depth}>\n`;
      },
      link(token) {
        const badge = badgeOf(token);
        const href = escapeHtml(resolve(token.href, "link"));
        if (badge !== undefined) return `<a class="install" href="${href}">${escapeHtml(badge.text)}</a>`;
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
        return `<a href="${href}"${title}>${this.parser.parseInline(token.tokens)}</a>`;
      },
      image({ href, title, text }) {
        const titled = title ? ` title="${escapeHtml(title)}"` : "";
        return `<img src="${escapeHtml(resolve(href, "image"))}" alt="${escapeHtml(text)}"${titled}>`;
      },
      paragraph({ tokens }) {
        const inner = this.parser.parseInline(tokens);
        const buttons = tokens.every((t) => badgeOf(t) !== undefined || (t.type === "text" && t.text.trim() === ""));
        return buttons ? `<p class="installs">${inner}</p>\n` : `<p>${inner}</p>\n`;
      },
      blockquote({ tokens }) {
        const inner = this.parser.parse(tokens);
        const alert = /^<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/.exec(inner);
        if (alert === null) return `<blockquote>\n${inner}</blockquote>\n`;
        const kind = alert[1] as string;
        return `<div class="alert alert-${kind.toLowerCase()}" role="note"><p class="alert-title">${ALERTS[kind]}</p><p>${inner.slice(alert[0].length)}</div>\n`;
      },
      code({ text, lang }) {
        const language = (lang ?? "").match(/^\S*/)?.[0] ?? "";
        const label = language === "" ? "" : ` data-lang="${escapeHtml(language)}"`;
        return `<pre tabindex="0"${label}><code>${escapeHtml(text)}</code></pre>\n`;
      },
      table(token) {
        const head = `<tr>${token.header.map((cell) => this.tablecell(cell)).join("")}</tr>`;
        const body = token.rows.map((row) => `<tr>${row.map((cell) => this.tablecell(cell)).join("")}</tr>`).join("\n");
        return `<div class="table" tabindex="0"><table>\n<thead>${head}</thead>\n<tbody>${body}</tbody>\n</table></div>\n`;
      },
      html({ text }) {
        for (const [, tag] of text.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)/g)) if (!KEPT.has((tag as string).toLowerCase())) strays.push(`<${tag as string}>`);
        return resolveAttributes(text, resolve);
      },
    },
  });
  const html = marked.parse(markdown, { async: false });
  return { html, headings, strays: [...new Set(strays)], ...(title === undefined ? {} : { title }) };
};

/** One line of Markdown (a tagline, "17 tools, including **money**") as inline HTML. */
export const renderInline = (markdown: string): string => new Marked({ gfm: true }).parseInline(markdown, { async: false });

/**
 * A README's sections by their level-two heading, each with its Markdown
 * (heading included), outside fenced code; and what comes before the first.
 */
export const sectionsOf = (markdown: string): { readonly preamble: string; readonly sections: ReadonlyMap<string, string> } => {
  const lines = markdown.split("\n");
  const sections = new Map<string, string[]>();
  const preamble: string[] = [];
  let current = preamble;
  let fenced = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (!fenced && line.startsWith("## ")) {
      current = [];
      sections.set(line.slice(3).trim(), current);
    }
    current.push(line);
  }
  return { preamble: preamble.join("\n"), sections: new Map([...sections].map(([heading, body]) => [heading, body.join("\n")])) };
};
