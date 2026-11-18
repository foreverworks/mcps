import { DECIMAL_TEXT, exactNumberText } from "@foreverworks/mcp-kit";

import { drift, fail } from "./errors.js";
import type {
  AppointmentCountsWire,
  AppointmentWire,
  DirectiveWire,
  DocumentDetailWire,
  DocumentRowWire,
  EmergencyContactWire,
  EmergencyEntryWire,
  InsuredWire,
  PackageDomainWire,
  Paged,
  PersonInformationsWire,
  PrescribedWire,
  ReimbursementRowWire,
  ReimbursementSummaryWire,
  ReleasedWire,
  StateRowWire,
} from "./schema.js";

/**
 * What the tools answer, mapped from the wire (schema.ts). Snake case, the
 * portal's Romanian words kept where they are the portal's own (a category's
 * description, a diagnosis), amounts as exact decimal strings in lei, and a
 * field the portal left empty as null rather than an invented default. Pure.
 */

export const CURRENCY = "RON";

/** The exact text of an amount the portal sent, or null when it sent none. */
export const amountText = (value: number | string | null | undefined, what: string): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return exactNumberText(value) ?? fail(drift(`${what}: ${String(value)} cannot be read as an exact amount`));
  const t = value.trim();
  return DECIMAL_TEXT.test(t) ? t : fail(drift(`${what}: "${value}" is not an amount`));
};

const or = <T>(value: T | null | undefined): T | null => value ?? null;

/** A day as the portal writes it ("2026-03-01", "2026-03-01T00:00:00"), as YYYY-MM-DD; anything else as it came. */
const day = (value: string | null | undefined): string | null => (value === null || value === undefined || value === "" ? null : (/^\d{4}-\d\d-\d\d/.exec(value)?.[0] ?? value));

const validity = (v: { readonly validFrom?: string | null | undefined; readonly validTo?: string | null | undefined }) => ({ valid_from: day(v.validFrom), valid_to: day(v.validTo) });

/** The page counters, when the portal gave them. */
export const pageOf = <T>(p: Paged<T>, page: number) => ({
  page,
  total_pages: or(p.totalPages),
  total: or(p.totalElements),
  count: p.body?.length ?? 0,
});

// ---- insurance --------------------------------------------------------------------------

export const insuranceView = (person: PersonInformationsWire, insured: InsuredWire, history: readonly StateRowWire[], services: ReadonlyMap<string, readonly PackageDomainWire[]>) => ({
  insured: or(insured.state),
  as_of: or(insured.requestDate),
  statuses: (person.statuses ?? []).map((s) => ({ code: or(s.code), description: or(s.description), ...validity(s) })),
  categories: (person.categories ?? []).map((c) => ({
    code: or(c.categoryCode),
    description: or(c.categoryDescription),
    ...validity(c),
    estimated_until: day(c.estimatedUntil),
    health_insurance_house: or(c.code),
    reported_by: or(c.reportedBy),
    approved_by: or(c.approvedBy),
  })),
  packages: (insured.insurancePackages ?? []).map((p) => ({
    code: or(p.code),
    name: or(p.name),
    valid_from: day(p.validFrom),
    services: (services.get(p.name ?? "") ?? []).map((d) => d.label ?? d.code ?? null).filter((label): label is string => label !== null),
  })),
  family_doctor_units: person.medicalUnits ?? [],
  history: history.map((s) => ({ code: or(s.code), description: or(s.description), ...validity(s) })),
});

// ---- prescriptions ----------------------------------------------------------------------

const prescriptionId = (p: { readonly series?: string | null | undefined; readonly no?: string | null | undefined }) => (p.series && p.no ? `${p.series} ${p.no}` : (p.no ?? null));

export const prescribedView = (p: NonNullable<PrescribedWire["prescriptions"]>[number]) => ({
  prescription: prescriptionId(p),
  date: day(p.prescriptionDate),
  diagnosis_code: or(p.diagnostic),
  doctor_stencil: or(p.physicianStencilNo),
  treatment_days: or(p.noDaysTreatment),
  part: or(p.fractionNo),
  drugs: (p.drugs ?? []).map((d) => ({
    active_substance: or(d.activeSubstance),
    concentration: or(d.concentration),
    form: or(d.pharmaceuticalForm),
    dose: or(d.dose),
    prescribed_quantity: or(d.prescriptedQuantity),
    released_quantity: or(d.issuedQuantity),
  })),
});

export const releasedView = (p: NonNullable<ReleasedWire["prescriptions"]>[number]) => ({
  prescription: prescriptionId(p),
  date: day(p.prescriptionDate),
  type: or(p.prescriptionType),
  doctor_stencil: or(p.physicianStencilNo),
  treatment_days: or(p.noDaysTreatment),
  part: or(p.fractionNo),
  copayment: amountText(p.copaymentValue, "a prescription's copayment"),
  currency: CURRENCY,
  drugs: (p.drugs ?? []).map((d) => ({
    name: or(d.drugName),
    code: or(d.drugCode),
    dose: or(d.dose),
    prescribed_quantity: or(d.prescriptedQuantity),
    released_quantity: or(d.issuedQuantity),
    released_on: day(d.drugIssueDate),
    pharmacy: or(d.pharmacyName),
    diagnosis_code: or(d.diagnosticCode),
    diagnosis: or(d.diagnosticDescription),
    days: or(d.noDaysAdministered),
  })),
});

// ---- reimbursed services ----------------------------------------------------------------

export const reimbursementView = (r: ReimbursementRowWire) => ({
  date: day(r.serviceDate),
  type: or(r.serviceType),
  service: or(r.serviceName),
  description: or(r.description),
  doctor: or(r.doctorName),
  provider: or(r.providerName),
  location: or(r.location),
  diagnosis_code: or(r.diagnosisCode),
  diagnosis: or(r.diagnosisName),
  reimbursed: amountText(r.reimbursedAmount, "a service's reimbursed amount"),
  currency: CURRENCY,
});

export const reimbursementSummaryView = (s: ReimbursementSummaryWire) => ({
  total_reimbursed: amountText(s.totalReimbursedAmount, "the total reimbursed") ?? "0",
  currency: CURRENCY,
  services: or(s.servicesCount),
  services_in_the_window_before: or(s.previousServicesCount),
  top_providers: (s.topProviders ?? []).map((p) => ({ provider: or(p.providerName), total: amountText(p.totalAmount, "a provider's total"), services: or(p.servicesCount) })),
});

// ---- medical documents ------------------------------------------------------------------

/** The portal shows "Raportat" (reported) as "Consumat": the form was used at a provider. */
const documentStatus = (code: string | null | undefined): string | null => (code === "Reported" ? "Consumed" : code === "Raportat" ? "Consumat" : or(code));

export const documentView = (d: DocumentRowWire) => ({
  id: d.id ?? fail(drift("a medical document in the list has no id")),
  title: or(d.displayTitle),
  status: documentStatus(d.statusCode),
  doctor_stencil: or(d.doctorStencil),
  issued: or(d.issueDate),
});

const scalar = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? "Da" : "Nu";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v.trim() === "" ? null : v.trim();
  return null;
};

const isField = (v: unknown): v is { readonly key?: unknown; readonly label?: unknown; readonly value?: unknown } =>
  typeof v === "object" && v !== null && "key" in v && "label" in v && "value" in v;

/** A field's value as the portal prints it: scalars joined with ", ", a table's rows with " | ". */
export const fieldText = (v: unknown): string | null => {
  if (!Array.isArray(v)) return scalar(v);
  if (v.length === 0) return null;
  const join = (parts: readonly (string | null)[], by: string): string | null => {
    const kept = parts.filter((p): p is string => p !== null);
    return kept.length === 0 ? null : kept.join(by);
  };
  const values = (fields: readonly unknown[]) => join(fields.filter(isField).map((f) => fieldText(f.value)), ", ");
  if (Array.isArray(v[0])) return join(v.map((row: unknown) => (Array.isArray(row) ? values(row) : scalar(row))), " | ");
  if (isField(v[0])) return values(v);
  return join(v.map(scalar), ", ");
};

export const documentDetailView = (id: string, d: DocumentDetailWire) => ({
  id,
  title: or(d.displayTitle),
  type: or(d.documentType),
  sections: (d.sections ?? [])
    .map((s) => ({
      title: s.label?.trim() || s.key || null,
      fields: (s.fields ?? []).map((f) => ({ label: f.label?.trim() || f.key || null, value: fieldText(f.value) })).filter((f) => f.value !== null),
    }))
    .filter((s) => s.fields.length > 0),
});

// ---- emergency summary ------------------------------------------------------------------

export const emergencyView = (entries: readonly EmergencyEntryWire[], contacts: readonly EmergencyContactWire[], directives: readonly DirectiveWire[]) => ({
  entries: entries.map((e) => ({ category: or(e.typeName), group: or(e.typeGroup), title: or(e.title), description: or(e.description), added_by: or(e.source) })),
  contacts: contacts.map((c) => ({
    name: [c.firstName, c.lastName].filter((p) => p !== null && p !== undefined && p !== "").join(" ") || null,
    relationship: or(c.relationship),
    relationship_details: or(c.relationshipDetails),
    phone: or(c.phone),
    email: or(c.email),
  })),
  advance_directives: directives.map((d) => ({ title: or(d.title), description: or(d.description) })),
});

// ---- appointments -----------------------------------------------------------------------

const countOf = (v: number | string | null | undefined): number | null => {
  if (typeof v === "number") return v;
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number(v.trim());
  return null;
};

export const appointmentCountsView = (c: AppointmentCountsWire) => ({ upcoming: countOf(c.FUTURE), waiting: countOf(c.WAITING), past: countOf(c.PAST), cancelled: countOf(c.CANCELLED) });

export const appointmentView = (a: AppointmentWire) => ({
  id: a.id ?? fail(drift("an appointment in the list has no id")),
  date: or(a.date),
  status: or(a.status),
  service: or(a.serviceName),
  specialty: or(a.specialtyName),
  doctor: or(a.doctorName),
  provider: or(a.agencyName ?? a.locationDetails?.agencyName),
  room: or(a.clinicalRoomName),
  address: [a.locationDetails?.adress, a.locationDetails?.localityName, a.locationDetails?.regionName].filter((p) => p !== null && p !== undefined && p !== "").join(", ") || null,
  minutes: or(a.allocatedMinutes),
  details: a.details?.trim() ? a.details.trim() : null,
});
