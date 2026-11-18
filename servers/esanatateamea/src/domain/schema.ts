import { z } from "zod";

/**
 * The portal's answers, as its own screens read them: every field optional,
 * because the answer is the portal's and a field it drops must fail in the
 * mapper that needs it (views.ts), not here. Only what a view uses is
 * declared; zod drops the rest, so nothing the portal adds travels on unread.
 *
 * Where these come from: insurance, prescriptions, the reimbursement summary,
 * the emergency-summary categories and the patient list were read from live
 * answers (2026-11); the reimbursement rows, documents, emergency entries,
 * contacts, directives and appointments from the portal's own client code,
 * which declares or maps every field below (its zod schemas for appointments
 * and the emergency summary).
 */
const text = z.string().nullable().optional();
const number = z.number().nullable().optional();
/** An amount: the portal's client holds them as doubles, so they arrive as JSON numbers; a string is taken too. */
const amount = z.union([z.number(), z.string()]).nullable().optional();
const list = <T extends z.ZodType>(item: T) => z.array(item).nullable().optional();

/** The portal's page: `body` and three counters (Spring's, renamed). */
export const pagedWire = <T extends z.ZodType>(item: T) => z.object({ totalPages: number, totalElements: number, pageSize: number, body: list(item) });
export type Paged<T> = { readonly totalPages?: number | null | undefined; readonly totalElements?: number | null | undefined; readonly pageSize?: number | null | undefined; readonly body?: readonly T[] | null | undefined };

// ---- insurance --------------------------------------------------------------------------

const validity = { validFrom: text, validTo: text };

export const personInformationsWire = z.object({
  statuses: list(z.object({ code: text, description: text, ...validity })),
  categories: list(z.object({ categoryCode: text, categoryDescription: text, ...validity, estimatedUntil: text, approvedBy: text, reportedBy: text, code: text })),
  medicalUnits: list(z.string()),
});
export type PersonInformationsWire = z.infer<typeof personInformationsWire>;

export const insuredWire = z.object({
  state: text,
  categories: list(z.object({ code: text, ...validity })),
  states: list(z.object({ code: text, ...validity })),
  insurancePackages: list(z.object({ code: text, name: text, validFrom: text })),
  requestDate: text,
});
export type InsuredWire = z.infer<typeof insuredWire>;

export const stateRowWire = z.object({ code: text, description: text, ...validity });
export type StateRowWire = z.infer<typeof stateRowWire>;

export const packageDomainWire = z.object({ code: text, label: text });
export type PackageDomainWire = z.infer<typeof packageDomainWire>;

// ---- prescriptions ----------------------------------------------------------------------

const prescriptionHead = { series: text, no: text, prescriptionDate: text, physicianStencilNo: text, noDaysTreatment: number, fractionNo: number };

export const prescribedWire = z.object({
  prescriptions: list(
    z.object({
      ...prescriptionHead,
      diagnostic: text,
      drugs: list(z.object({ activeSubstance: text, concentration: text, pharmaceuticalForm: text, dose: text, prescriptedQuantity: number, issuedQuantity: number })),
    }),
  ),
});
export type PrescribedWire = z.infer<typeof prescribedWire>;

export const releasedWire = z.object({
  prescriptions: list(
    z.object({
      ...prescriptionHead,
      prescriptionType: text,
      copaymentValue: amount,
      drugs: list(
        z.object({
          drugName: text,
          drugCode: text,
          dose: text,
          prescriptedQuantity: number,
          issuedQuantity: number,
          drugIssueDate: text,
          pharmacyName: text,
          diagnosticCode: text,
          diagnosticDescription: text,
          noDaysAdministered: number,
        }),
      ),
    }),
  ),
});
export type ReleasedWire = z.infer<typeof releasedWire>;

// ---- reimbursed services ----------------------------------------------------------------

export const reimbursementRowWire = z.object({
  id: z.union([z.string(), z.number()]).nullable().optional(),
  serviceDate: text,
  serviceType: text,
  serviceName: text,
  description: text,
  doctorName: text,
  providerName: text,
  location: text,
  diagnosisCode: text,
  diagnosisName: text,
  reimbursedAmount: amount,
});
export type ReimbursementRowWire = z.infer<typeof reimbursementRowWire>;

export const reimbursementSummaryWire = z.object({
  totalReimbursedAmount: amount,
  servicesCount: number,
  previousServicesCount: number,
  topProviders: list(z.object({ providerName: text, totalAmount: amount, servicesCount: number })),
});
export type ReimbursementSummaryWire = z.infer<typeof reimbursementSummaryWire>;

// ---- medical documents ------------------------------------------------------------------

export const documentRowWire = z.object({ id: text, displayTitle: text, statusCode: text, doctorStencil: text, issueDate: text });
export type DocumentRowWire = z.infer<typeof documentRowWire>;

/** A field's value: a scalar, a list of scalars, a list of fields, or a table (a list of lists of fields). */
export const documentDetailWire = z.object({
  displayTitle: text,
  documentType: text,
  sections: list(z.object({ key: text, label: text, fields: list(z.object({ key: text, label: text, value: z.unknown() })) })),
});
export type DocumentDetailWire = z.infer<typeof documentDetailWire>;

// ---- emergency summary ------------------------------------------------------------------

export const emergencyEntryWire = z.object({ id: text, title: text, description: text, typeName: text, typeGroup: text, source: text });
export type EmergencyEntryWire = z.infer<typeof emergencyEntryWire>;

export const emergencyContactWire = z.object({ id: text, firstName: text, lastName: text, email: text, phone: text, relationship: text, relationshipDetails: text });
export type EmergencyContactWire = z.infer<typeof emergencyContactWire>;

export const directiveWire = z.object({ id: text, title: text, description: text });
export type DirectiveWire = z.infer<typeof directiveWire>;

// ---- appointments -----------------------------------------------------------------------

/** The four tabs' counters; the portal's client accepts them as numbers or numeric strings. */
const count = z.union([z.number(), z.string()]).nullable().optional();
export const appointmentCountsWire = z.object({ FUTURE: count, WAITING: count, PAST: count, CANCELLED: count });
export type AppointmentCountsWire = z.infer<typeof appointmentCountsWire>;

export const appointmentWire = z.object({
  id: text,
  date: text,
  status: text,
  details: text,
  doctorName: text,
  agencyName: text,
  specialtyName: text,
  serviceName: text,
  clinicalRoomName: text,
  allocatedMinutes: number,
  locationDetails: z.object({ agencyName: text, adress: text, localityName: text, regionName: text }).nullable().optional(),
});
export type AppointmentWire = z.infer<typeof appointmentWire>;
