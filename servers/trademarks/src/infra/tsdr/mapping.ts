import { driftError, fail, TSDR_SOURCE } from "../../domain/errors.js";
import type { MarkDocument, MarkEvent, MarkHistory, MarkStatus } from "../../domain/mark.js";
import { tsdrLink } from "../uspto/mapping.js";
import type { TsdrCase } from "./schema.js";

/** TSDR's dates come as days, timestamps at Eastern midnight ("2022-11-29T05:00:00.000+0000") or days with an offset ("2022-11-29-05:00"): the day is the first ten characters. */
const day = (value: string | null | undefined): string | undefined => (value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : undefined);

/**
 * Registered, pending or dead, from TSDR's summary category ("LIVE/REGISTRATION/Issued and Active",
 * "LIVE/APPLICATION/...", "DEAD/..."); without one, from the abandonment date and the registration number.
 */
const statusOf = (s: TsdrCase["trademarks"][number]["status"]): MarkStatus => {
  const category = s.tm5StatusDesc?.toUpperCase() ?? "";
  if (category.startsWith("DEAD")) return "dead";
  if (category.startsWith("LIVE/REGISTRATION")) return "registered";
  if (category.startsWith("LIVE")) return "pending";
  return s.dateAbandoned ? "dead" : s.usRegistrationNumber ? "registered" : "pending";
};

const optional = <K extends string>(key: K, value: string | undefined | null) => (value ? ({ [key]: value } as Record<K, string>) : {});

export const toHistory = (answer: TsdrCase): MarkHistory => {
  const one = answer.trademarks[0] ?? fail(driftError(TSDR_SOURCE, "TSDR answered a case with no trademark in it"));
  const s = one.status;
  const id = String(s.serialNumber).padStart(8, "0");
  const events = (one.prosecutionHistory ?? [])
    .flatMap((e): MarkEvent[] => {
      const date = day(e.entryDate);
      return date === undefined || !e.entryDesc ? [] : [{ date, code: e.entryCode ?? "", description: e.entryDesc.trim(), number: e.entryNumber ?? 0 }];
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.number - a.number);
  return {
    office: "US",
    id,
    mark: s.markElement?.trim() || null,
    status: statusOf(s),
    statusText: s.extStatusDesc?.replace(/\s+/g, " ").trim() || String(s.status),
    statusCode: s.status,
    ...optional("statusDate", day(s.statusDate)),
    ...optional("category", s.tm5StatusDesc?.trim()),
    ...optional("filed", day(s.filingDate)),
    ...(s.usRegistrationNumber ? { ...optional("registered", day(s.usRegistrationDate)), registrationNumber: s.usRegistrationNumber } : {}),
    ...optional("renewed", day(s.dateRenewal)),
    ...optional("abandoned", day(s.dateAbandoned)),
    events,
    link: tsdrLink(id),
  };
};

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescaped = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name: string) =>
    name.startsWith("#x") || name.startsWith("#X") ? String.fromCodePoint(parseInt(name.slice(2), 16)) : name.startsWith("#") ? String.fromCodePoint(Number(name.slice(1))) : (ENTITIES[name] ?? whole),
  );

const field = (xml: string, tag: string): string | undefined => {
  const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
  return m?.[1] === undefined ? undefined : unescaped(m[1]).trim();
};

/**
 * A case's document list as TSDR answers it (`GET /casedocs/sn<serial>/info`,
 * XML only: it refuses JSON with 406), recorded 2026-10-22: a flat
 * `<DocumentList xmlns="urn:us:gov:doc:uspto:trademark">` of `<Document>`s,
 * newest first. Anything else is drift.
 */
export const documentsIn = (xml: string): readonly MarkDocument[] => {
  if (!/<DocumentList\b[^>]*xmlns="urn:us:gov:doc:uspto:trademark"/.test(xml)) fail(driftError(TSDR_SOURCE, "TSDR's document list is not the DocumentList it was"));
  return [...xml.matchAll(/<Document>([\s\S]*?)<\/Document>/g)]
    .map((m): MarkDocument => {
      const doc = m[1] ?? "";
      const date = day(field(doc, "MailRoomDate")) ?? day(field(doc, "ScanDateTime"));
      const type = field(doc, "DocumentTypeCode");
      if (date === undefined || !type) return fail(driftError(TSDR_SOURCE, "a TSDR document has no date or no type code"));
      const pages = Number(field(doc, "TotalPageQuantity"));
      return {
        date,
        type,
        description: field(doc, "DocumentTypeCodeDescriptionText") ?? field(doc, "DocumentTypeDescriptionText") ?? type,
        category: (field(doc, "CategoryTypeCodeDescriptionText") ?? field(doc, "CategoryTypeCode") ?? "").toLowerCase(),
        ...(Number.isInteger(pages) && pages > 0 ? { pages } : {}),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
};
