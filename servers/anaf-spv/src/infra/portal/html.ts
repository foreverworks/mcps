/**
 * Just enough HTML reading for SPV's pages, which are server-rendered JSF and
 * an F5 sign-in form: attribute values, a select's options, visible text.
 * Regular expressions over known markup, because a DOM parser would be a
 * dependency for six patterns. Pure.
 */

const NAMED: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export const decodeEntities = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return NAMED[entity.toLowerCase()] ?? whole;
  });

/** The text a person sees: no scripts, styles or comments, tags as spaces, entities decoded, one space between words. */
export const visibleText = (html: string): string =>
  decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();

/** The same text, one line per block (cells, rows, paragraphs), for comparing two renderings of a page. */
export const visibleLines = (html: string): readonly string[] =>
  decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "\n")
      .replace(/<style[\s\S]*?<\/style>/gi, "\n")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, "\n")
      .replace(/<!--[\s\S]*?-->/g, "\n")
      .replace(/<\/?(?:div|p|br|tr|td|th|li|ul|h\d|table|form|span|label|option)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);

/** Every tag `<name ...>` in the markup, as its text. */
export const tags = (html: string, name: string): readonly string[] => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((m) => m[0]);

/** One attribute of a tag's text, quoted or bare, decoded. */
export const attribute = (tag: string, name: string): string | undefined => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  if (m === null) return undefined;
  return decodeEntities(m[1] ?? m[2] ?? m[3] ?? "");
};

/** The first tag with this attribute value (`id="PF"`, `name="form1:cui"`). */
export const tagWith = (html: string, name: string, attr: string, value: string): string | undefined =>
  tags(html, name).find((tag) => attribute(tag, attr) === value);

/** A whole element, from its opening tag to the matching close, for elements that do not nest (form, select). */
export const element = (html: string, name: string, attr: string, value: string): string | undefined => {
  for (const m of html.matchAll(new RegExp(`<${name}\\b[^>]*>[\\s\\S]*?</${name}>`, "gi"))) {
    const open = /^<[^>]*>/.exec(m[0])?.[0] ?? "";
    if (attribute(open, attr) === value) return m[0];
  }
  return undefined;
};

/** A select's options: value and label. */
export const options = (select: string): readonly { readonly value: string; readonly label: string }[] =>
  [...select.matchAll(/<option\b([^>]*)>([^<]*)/gi)].map((m) => {
    const label = decodeEntities(m[2] ?? "").trim();
    return { value: attribute(`<option${m[1] ?? ""}>`, "value") ?? label, label };
  });

/** The value of the input named `name`, or undefined. */
export const inputValue = (html: string, name: string): string | undefined => {
  const tag = tagWith(html, "input", "name", name);
  return tag === undefined ? undefined : (attribute(tag, "value") ?? "");
};
