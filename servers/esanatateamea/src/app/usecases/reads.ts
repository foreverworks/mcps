import { mapWithConcurrency } from "@foreverworks/mcp-kit";

import { localMinute, windowOf } from "../../domain/dates.js";
import { asAppError, fail, needsLogin } from "../../domain/errors.js";
import {
  appointmentCountsView,
  appointmentView,
  documentDetailView,
  documentView,
  emergencyView,
  insuranceView,
  pageOf,
  prescribedView,
  reimbursementSummaryView,
  reimbursementView,
  releasedView,
} from "../../domain/views.js";
import type { AppointmentTab, Deps } from "../ports.js";

/**
 * The patient's own records, as the portal's screens show them. Every one of
 * these needs the session; a missing or dead one surfaces from the portal
 * port as `needs_login` (or, with a password configured, as a fresh sign-in
 * first). Nothing here changes anything at CNAS.
 */

/** "Pachetul meu" and "Starea mea": insured or not, the categories and packages, the history. */
export const getInsurance = async (deps: Deps) => {
  const [person, insured, history] = await Promise.all([deps.portal.personInformations(), deps.portal.insured(), deps.portal.insuranceHistory()]);
  const names = [...new Set((insured.insurancePackages ?? []).map((p) => p.name).filter((n): n is string => typeof n === "string" && n !== ""))];
  const services = new Map(await mapWithConcurrency(names, 2, async (name) => [name, await deps.portal.packageDomains(name)] as const));
  return { ok: true as const, ...insuranceView(person, insured, history, services) };
};

/** "Istoric rețete": what doctors prescribed, and what pharmacies released against it, in a window. */
export const listPrescriptions = async (deps: Deps, args: { readonly from?: string | undefined; readonly to?: string | undefined }) => {
  const window = windowOf(args.from, args.to, deps.now() * 1000, 365);
  const [prescribed, released] = await Promise.all([deps.portal.prescribed(window), deps.portal.released(window)]);
  return { ok: true as const, window, prescribed: (prescribed.prescriptions ?? []).map(prescribedView), released: (released.prescriptions ?? []).map(releasedView) };
};

/** "Istoric decontări": the services CNAS paid a provider for, with the window's total. */
export const listReimbursedServices = async (deps: Deps, args: { readonly from?: string | undefined; readonly to?: string | undefined; readonly page: number; readonly size: number }) => {
  const window = windowOf(args.from, args.to, deps.now() * 1000, 365);
  const [summary, rows] = await Promise.all([deps.portal.reimbursementSummary(window), deps.portal.reimbursements(window, args.page, args.size)]);
  return { ok: true as const, window, summary: reimbursementSummaryView(summary), ...pageOf(rows, args.page), items: (rows.body ?? []).map(reimbursementView) };
};

/** "Formulare medicale": referrals, prescriptions on paper, letters, certificates. No window unless one is asked for. */
export const listMedicalDocuments = async (
  deps: Deps,
  args: { readonly from?: string | undefined; readonly to?: string | undefined; readonly search?: string | undefined; readonly page: number; readonly size: number },
) => {
  const window = args.from === undefined && args.to === undefined ? undefined : windowOf(args.from, args.to, deps.now() * 1000, 365);
  const rows = await deps.portal.documents({ window, search: args.search }, args.page, args.size);
  return { ok: true as const, ...(window === undefined ? {} : { window }), ...pageOf(rows, args.page), items: (rows.body ?? []).map(documentView) };
};

/**
 * The portal answers an id it does not hold with a 500 like any failure of its
 * own (observed 2026-11-18), so a 500 for one document says that it may be
 * the id.
 */
const forDocument = <T>(id: string, run: () => Promise<T>): Promise<T> =>
  run().catch((thrown: unknown) => {
    const failure = asAppError(thrown);
    if (failure?.kind !== "api" || failure.status !== 500) throw thrown;
    return fail({ ...failure, message: `${failure.message}; the portal answers the same for a document id it does not hold, so check that "${id}" came from list_medical_documents` });
  });

export const getMedicalDocument = async (deps: Deps, args: { readonly id: string }) => ({
  ok: true as const,
  document: documentDetailView(args.id, await forDocument(args.id, () => deps.portal.document(args.id))),
});

/** The document as the portal's PDF, to the outbox. */
export const downloadMedicalDocument = async (deps: Deps, args: { readonly id: string }) => {
  const bytes = await forDocument(args.id, () => deps.portal.documentPdf(args.id));
  const saved = await deps.outbox.save(`docmed-${args.id}.pdf`, bytes);
  return { ok: true as const, id: args.id, file: saved };
};

/** "Sumar de urgență": what a doctor in an emergency should know, the people to call, the advance directives; optionally the portal's PDF. */
export const getEmergencySummary = async (deps: Deps, args: { readonly pdf: boolean }) => {
  const [entries, contacts, directives] = await Promise.all([deps.portal.emergencyEntries(), deps.portal.emergencyContacts(), deps.portal.advanceDirectives()]);
  const file = args.pdf ? await deps.outbox.save("sumar-urgenta.pdf", await deps.portal.emergencyPdf()) : undefined;
  return { ok: true as const, ...emergencyView(entries, contacts, directives), ...(file === undefined ? {} : { file }) };
};

/** "Programările mele": the tab's appointments and the four tabs' counts, for the signed-in person. */
export const listAppointments = async (deps: Deps, args: { readonly tab: AppointmentTab; readonly page: number; readonly size: number }) => {
  const stored =
    (await deps.session.read()) ?? (deps.credentials.configured ? await deps.session.rotate() : fail(needsLogin("never_connected", "no session is stored; nobody has signed in through this server yet")));
  const cid = deps.claimsOf(stored.accessToken).cid ?? fail({ kind: "drift", message: "the session's access token carries no cid claim, which the appointment endpoints take" });
  const [counts, rows] = await Promise.all([deps.portal.appointmentCounts(cid), deps.portal.appointments(cid, args.tab, localMinute(deps.now() * 1000), args.page, args.size)]);
  return { ok: true as const, tab: args.tab, counts: appointmentCountsView(counts), ...pageOf(rows, args.page), items: (rows.body ?? []).map(appointmentView) };
};
