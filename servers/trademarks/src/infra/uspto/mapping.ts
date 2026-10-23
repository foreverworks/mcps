import type { GoodsAndServices, Mark, MarkDetail, MarkStatus } from "../../domain/mark.js";
import { folded } from "../../domain/match.js";
import type { UsptoMark } from "./schema.js";

/** USPTO's own status page for a serial number, the link its search page gives. */
export const tsdrLink = (serial: string): string =>
  `https://tsdr.uspto.gov/#caseNumber=${serial}&caseSearchType=US_APPLICATION&caseType=DEFAULT&searchType=statusSearch`;

/** Dead is USPTO's own flag; a live mark with a registration number is registered, without one it is an application. */
const statusOf = (m: UsptoMark): MarkStatus => (m.alive === false ? "dead" : m.registrationId ? "registered" : "pending");

const CLASS = /^(\(CANCELLED\)\s*)?IC\s+(\d{1,3})\b/i;

/**
 * "IC 035" and "(CANCELLED) IC 035": the classes it covers now, else (a dead
 * registration, every class cancelled) the ones it had. US classes (A, B, 200)
 * are not Nice classes and are left out.
 */
export const classesOf = (entries: readonly string[] | null | undefined): readonly number[] => {
  const parsed = (entries ?? []).flatMap((e) => {
    const m = CLASS.exec(e.trim());
    const n = m ? Number(m[2]) : NaN;
    return n >= 1 && n <= 45 ? [{ n, cancelled: m?.[1] !== undefined }] : [];
  });
  const active = parsed.filter((c) => !c.cancelled);
  return [...new Set((active.length > 0 ? active : parsed).map((c) => c.n))].sort((a, b) => a - b);
};

/** USPTO's drawing codes (TMEP 807): 1 typed and 4 standard characters are words; 2, 3 and 5 carry a design or stylisation. */
const kindOf = (code: number | string | null | undefined): string | undefined => {
  switch (String(code ?? "").charAt(0)) {
    case "1":
    case "4":
      return "word";
    case "2":
    case "3":
    case "5":
      return "figurative";
    case "6":
      return "other";
    default:
      return undefined;
  }
};

const day = (iso: string | null | undefined): string | undefined => (iso ? iso.slice(0, 10) : undefined);

export const toMark = (m: UsptoMark): Mark => {
  const kind = kindOf(m.drawingCode);
  const filed = day(m.filedDate);
  const registered = m.registrationId ? day(m.registrationDate) : undefined;
  return {
    office: "US",
    id: m.id,
    mark: m.wordmark?.trim() || null,
    status: statusOf(m),
    statusText: m.statusDescription ?? (m.alive === false ? "DEAD" : "LIVE"),
    owners: m.ownerName ?? [],
    classes: classesOf(m.internationalClass),
    ...(kind === undefined ? {} : { kind }),
    ...(filed === undefined ? {} : { filed }),
    ...(registered === undefined ? {} : { registered }),
    ...(m.registrationId ? { registrationNumber: m.registrationId } : {}),
    ...(m.translation?.trim() ? { translation: m.translation.trim() } : {}),
    link: tsdrLink(m.id),
  };
};

/** Each class's text, cut where it stops being a summary: the whole list is on the office's page. */
export const TERMS_MAX = 600;

const GOODS = /^(\(CANCELLED\)\s*)?IC\s+(\d{1,3})\s*:\s*(.*)$/is;

const goodsOf = (entries: readonly string[] | null | undefined): readonly GoodsAndServices[] =>
  (entries ?? []).flatMap((e) => {
    const m = GOODS.exec(e.trim());
    if (!m) return [];
    const terms = (m[3] ?? "").replace(/\s+/g, " ").trim();
    return [{ class: Number(m[2]), ...(m[1] ? { cancelled: true as const } : {}), terms: terms.length > TERMS_MAX ? `${terms.slice(0, TERMS_MAX)}...` : terms }];
  });

export const toDetail = (m: UsptoMark): MarkDetail => ({ ...toMark(m), goodsAndServices: goodsOf(m.goodsAndServices) });

const words = (text: string): readonly string[] => folded(text, " ").split(" ").filter((w) => w.length > 0);

const holdsPhrase = (text: string, phrase: readonly string[]): boolean => {
  const w = words(text);
  return phrase.length > 0 && w.some((_, i) => phrase.every((p, j) => w[i + j] === p));
};

/**
 * Whether the goods words appear in a mark only in classes it has cancelled,
 * the one case where USPTO's index (which keeps cancelled text) finds a mark
 * that no longer covers them. Words that appear nowhere here, as USPTO's
 * analyser may have matched a plural or a stem, leave the mark in: only a
 * cancelled-only match is evidence enough to drop it.
 */
export const onlyInCancelled = (entries: readonly string[] | null | undefined, goods: string): boolean => {
  const phrase = words(goods);
  const parsed = (entries ?? []).flatMap((e) => {
    const m = GOODS.exec(e.trim());
    return m ? [{ cancelled: m[1] !== undefined, terms: m[3] ?? "" }] : [];
  });
  return parsed.some((g) => g.cancelled && holdsPhrase(g.terms, phrase)) && !parsed.some((g) => !g.cancelled && holdsPhrase(g.terms, phrase));
};
