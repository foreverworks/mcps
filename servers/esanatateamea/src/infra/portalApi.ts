import { type HttpRequest, issuesText } from "@foreverworks/mcp-kit";
import { z } from "zod";

import type { AppointmentTab, PortalPort } from "../app/ports.js";
import { fail } from "../domain/errors.js";
import {
  appointmentCountsWire,
  appointmentWire,
  directiveWire,
  documentDetailWire,
  documentRowWire,
  emergencyContactWire,
  emergencyEntryWire,
  insuredWire,
  packageDomainWire,
  pagedWire,
  personInformationsWire,
  prescribedWire,
  reimbursementRowWire,
  reimbursementSummaryWire,
  releasedWire,
  stateRowWire,
} from "../domain/schema.js";

/**
 * The portal's endpoints, the only module that names them. Each backend sits
 * under `/api` (the portal's env.js names them): `insurance`,
 * `prescription-history`, `reimbursement`, `nomenclator` (the patient's own
 * records: emergency summary, contacts, directives) and `programari`
 * (documents and appointments). Pages count from 0. Every call is a read; the
 * two document searches are POSTs with a filter body, sent as idempotent.
 */
const PDF_OR_ERROR = "application/pdf, application/json;q=0.9, */*;q=0.8";

export const makePortalApi = (http: HttpRequest, portal: string): PortalPort => {
  const api = `${portal}/api`;

  const parsed = <S extends z.ZodType>(schema: S, answer: unknown, what: string): z.infer<S> => {
    const result = schema.safeParse(answer);
    return result.success ? result.data : fail({ kind: "drift", message: `${what}: ${issuesText(result.error)}` });
  };

  /** A list the portal's screens read whole: the overview endpoints, 100 a page, at most 20 pages (what the portal itself reads). */
  const everything = async <S extends z.ZodType>(url: string, item: S, what: string): Promise<z.infer<S>[]> => {
    const all: z.infer<S>[] = [];
    for (let page = 0; page < 20; page++) {
      const p = parsed(pagedWire(item), await http(url, { query: { page, size: 100 } }), what);
      all.push(...(p.body ?? []));
      if (page + 1 >= (p.totalPages ?? 1)) break;
    }
    return all;
  };

  /** The appointment tabs, as the portal's own screen asks for them. */
  const tabQuery = (tab: AppointmentTab, nowLocal: string): Record<string, string> => {
    switch (tab) {
      case "upcoming":
        return { statuses: "CONFIRMED", sortDirection: "ASC", dateFrom: nowLocal };
      case "waiting":
        return { statuses: "CREATED", sortDirection: "DESC", dateFrom: nowLocal };
      case "past":
        return { scope: "PAST_TAB", sortDirection: "DESC", dateTo: nowLocal };
      case "cancelled":
        return { statuses: "CANCELLED,NOT_CONFIRMED", sortDirection: "DESC" };
    }
  };

  return {
    personInformations: async () => parsed(personInformationsWire, await http(`${api}/insurance/person-informations`), "person-informations"),
    insured: async () => parsed(insuredWire, await http(`${api}/insurance/person-informations/insured`), "person-informations/insured"),
    insuranceHistory: async () => parsed(z.array(stateRowWire), await http(`${api}/insurance/person-informations/states`), "person-informations/states"),
    packageDomains: async (packageName) =>
      parsed(z.array(packageDomainWire), await http(`${api}/nomenclator/services-insurance/domains`, { query: { packageName } }), "services-insurance/domains"),
    prescribed: async (w) => parsed(prescribedWire, await http(`${api}/prescription-history/prescribed`, { query: { fromDate: w.from, toDate: w.to } }), "prescriptions prescribed"),
    released: async (w) => parsed(releasedWire, await http(`${api}/prescription-history/released`, { query: { fromDate: w.from, toDate: w.to } }), "prescriptions released"),
    reimbursements: async (w, page, size) =>
      parsed(
        pagedWire(reimbursementRowWire),
        await http(`${api}/reimbursement/medical-history`, { query: { page, size, dateFrom: w.from, dateTo: w.to, sortBy: "serviceDate", sortDirection: "DESC" } }),
        "medical-history",
      ),
    reimbursementSummary: async (w) => parsed(reimbursementSummaryWire, await http(`${api}/reimbursement/medical-history/summary`, { query: { dateFrom: w.from, dateTo: w.to } }), "medical-history/summary"),
    documents: async (filter, page, size) => {
      const body: Record<string, string> = {};
      if (filter.window !== undefined) {
        body["deLa"] = filter.window.from;
        body["panaLa"] = filter.window.to;
      }
      if (filter.search !== undefined) body["search"] = filter.search;
      return parsed(pagedWire(documentRowWire), await http(`${api}/programari/docmed`, { method: "POST", idempotent: true, query: { page, size }, json: body }), "docmed");
    },
    document: async (id) => parsed(documentDetailWire, await http(`${api}/programari/docmed/${encodeURIComponent(id)}`), "docmed detail"),
    // The portal answers 406 to a request that accepts only a PDF when what it has is an error, so
    // the error's JSON is accepted too: the failure then says what the portal said.
    documentPdf: (id) => http<Uint8Array>(`${api}/programari/docmed/download/${encodeURIComponent(id)}`, { as: "bytes", headers: { accept: PDF_OR_ERROR } }),
    emergencyEntries: () => everything(`${api}/nomenclator/emergency-summary/overview`, emergencyEntryWire, "emergency-summary"),
    emergencyContacts: () => everything(`${api}/nomenclator/person-contact/overview`, emergencyContactWire, "person-contact"),
    advanceDirectives: () => everything(`${api}/nomenclator/advance-directive/overview`, directiveWire, "advance-directive"),
    emergencyPdf: () => http<Uint8Array>(`${api}/nomenclator/emergency-export/pdf`, { as: "bytes", headers: { accept: PDF_OR_ERROR } }),
    appointmentCounts: async (cid) =>
      parsed(appointmentCountsWire, await http(`${api}/programari/appointment/summary-tabs`, { query: { zone: "Europe/Bucharest", patientCID: cid } }), "appointment/summary-tabs"),
    appointments: async (cid, tab, nowLocal, page, size) =>
      parsed(
        pagedWire(appointmentWire),
        await http(`${api}/programari/appointment/overview`, { query: { page, size, sortBy: "date", ...tabQuery(tab, nowLocal), patients: cid } }),
        "appointment/overview",
      ),
  };
};
