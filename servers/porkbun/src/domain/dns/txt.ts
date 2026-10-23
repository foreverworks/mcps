/**
 * What a TXT record says, as a resolver reads it, and which kind of record it
 * is. Pure.
 */

const QUOTED = /"((?:[^"\\]|\\.)*)"/g;

/**
 * The text a resolver hands out: quoted strings joined (`"v=DKIM1; p=MIIB" "IjAN..."`, how a key
 * longer than 255 characters is written), else the content as given.
 */
export const txtText = (content: string): string => {
  const trimmed = content.trim();
  if (!trimmed.startsWith('"')) return trimmed;
  const parts = [...trimmed.matchAll(QUOTED)].map((m) => (m[1] ?? "").replace(/\\(.)/g, "$1"));
  return parts.length === 0 ? trimmed : parts.join("");
};

/** An SPF record: `v=spf1` and a space or nothing after it (RFC 7208 4.5). */
export const isSpf = (text: string): boolean => /^v=spf1(?:\s|$)/i.test(text);

/** A DKIM record's tags (RFC 6376 3.6.1), names lower-cased, values without the spaces DKIM allows inside them. */
export const dkimTags = (text: string): ReadonlyMap<string, string> =>
  new Map(
    text
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.includes("="))
      .map((part) => {
        const at = part.indexOf("=");
        return [part.slice(0, at).trim().toLowerCase(), part.slice(at + 1).replace(/\s+/g, "")] as const;
      }),
  );

/** A DKIM key record: it says `v=DKIM1`, or it sits under `_domainkey` and carries a `p=`. */
export const isDkim = (name: string | undefined, text: string): boolean =>
  /^v\s*=\s*DKIM1\s*(?:;|$)/i.test(text) || (/(?:^|\.)_domainkey(?:\.|$)/i.test(name ?? "") && dkimTags(text).has("p"));
