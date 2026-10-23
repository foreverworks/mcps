import type { Mark, MarkDetail, MarkStatus } from "../../domain/mark.js";
import { DEAD_STATUSES } from "./rsql.js";
import type { EuipoDetail, EuipoItem } from "./schema.js";

/** The office's own page for an application number. */
export const eSearchLink = (applicationNumber: string): string => `https://euipo.europa.eu/eSearch/#details/trademarks/${applicationNumber}`;

/** CANCELLATION_PENDING is a registration under challenge: still registered until decided. */
const REGISTERED = new Set(["REGISTERED", "CANCELLATION_PENDING"]);
const DEAD = new Set<string>(DEAD_STATUSES);

const statusOf = (status: string): MarkStatus => (DEAD.has(status) ? "dead" : REGISTERED.has(status) ? "registered" : "pending");

export const toMark = (t: EuipoItem): Mark => {
  const owners = (t.applicants ?? []).flatMap((a) => (a.name ? [a.name] : []));
  return {
    office: "EM",
    id: t.applicationNumber,
    mark: t.wordMarkSpecification?.verbalElement.trim() || null,
    status: statusOf(t.status),
    statusText: t.status,
    owners,
    classes: [...new Set(t.niceClasses ?? [])].sort((a, b) => a - b),
    ...(t.markFeature ? { kind: t.markFeature.toLowerCase() } : {}),
    ...(t.applicationDate ? { filed: t.applicationDate.slice(0, 10) } : {}),
    ...(t.registrationDate ? { registered: t.registrationDate.slice(0, 10) } : {}),
    link: eSearchLink(t.applicationNumber),
  };
};

export const TERMS_MAX = 600;

/** The English terms when EUIPO has them (the request asks for `en`), else the first language it returned. */
export const toDetail = (t: EuipoDetail): MarkDetail => ({
  ...toMark(t),
  goodsAndServices: (t.goodsAndServices ?? []).map((g) => {
    const text = (g.description?.find((d) => d.language === "en") ?? g.description?.[0])?.terms.join("; ") ?? "";
    return { class: g.classNumber, terms: text.length > TERMS_MAX ? `${text.slice(0, TERMS_MAX)}...` : text };
  }),
  ...(t.expiryDate ? { expires: t.expiryDate.slice(0, 10) } : {}),
  ...(t.statusDate ? { statusDate: t.statusDate.slice(0, 10) } : {}),
});
