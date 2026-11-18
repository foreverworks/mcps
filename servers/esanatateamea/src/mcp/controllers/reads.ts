import { z } from "zod";

import {
  downloadMedicalDocument,
  getEmergencySummary,
  getInsurance,
  getMedicalDocument,
  listAppointments,
  listMedicalDocuments,
  listPrescriptions,
  listReimbursedServices,
} from "../../app/usecases/reads.js";
import { documentId, from, page, size, to } from "../args.js";
import type { Registrar } from "./types.js";

export const registerReads: Registrar = (server, deps, handled) => {
  server.registerTool(
    "get_insurance",
    {
      title: "Insurance",
      description:
        '"Starea mea" and "Pachetul meu": whether the person is insured now (CNAS\'s word, such as "Asigurat"), the insured categories with their validity and the house that reported them, ' +
        "the statuses, the service package and the kinds of care it covers, the family doctor's unit codes, and the history of insured statuses.",
      inputSchema: {},
    },
    handled(() => getInsurance(deps)),
  );

  server.registerTool(
    "list_prescriptions",
    {
      title: "Prescriptions",
      description:
        '"Istoric rețete": the electronic prescriptions in a window, as prescribed (drugs, doses, quantities, the doctor\'s stencil, the diagnosis code) and as released at a pharmacy ' +
        "(drug names, quantities released, the pharmacy, the day, the copayment in lei).",
      inputSchema: { from, to },
    },
    handled((args) => listPrescriptions(deps, args)),
  );

  server.registerTool(
    "list_reimbursed_services",
    {
      title: "Reimbursed services",
      description:
        '"Istoric decontări": the medical services CNAS paid a provider for on the person\'s behalf (consultations, tests, hospital stays), newest first, with the provider, the doctor, ' +
        "the diagnosis and the amount, and the window's total and top providers.",
      inputSchema: { from, to, page, size },
    },
    handled((args) => listReimbursedServices(deps, args)),
  );

  server.registerTool(
    "list_medical_documents",
    {
      title: "Medical documents",
      description:
        '"Formulare medicale": referrals (bilete de trimitere), medical letters, certificates and other forms providers issued, newest first, with their status (Consumat: used at a provider). ' +
        "No window unless one is given. get_medical_document reads one; download_medical_document saves its PDF.",
      inputSchema: { from, to, search: z.string().trim().min(1).optional().describe("Words to look for, as the portal's own search box."), page, size },
    },
    handled((args) => listMedicalDocuments(deps, args)),
  );

  server.registerTool(
    "get_medical_document",
    {
      title: "Medical document",
      description: "One medical document's contents, section by section, as the portal's preview shows them (the issuer, the patient's details, the diagnosis, what was prescribed or recommended).",
      inputSchema: { id: documentId },
    },
    handled((args) => getMedicalDocument(deps, args)),
  );

  server.registerTool(
    "download_medical_document",
    {
      title: "Download medical document",
      description: "Saves one medical document as the portal's PDF into this server's outbox, and answers its path, SHA-256 and size.",
      inputSchema: { id: documentId },
    },
    handled((args) => downloadMedicalDocument(deps, args)),
  );

  server.registerTool(
    "get_emergency_summary",
    {
      title: "Emergency summary",
      description:
        '"Sumar de urgență": what a doctor should know in an emergency (conditions, allergies, treatments, as the person or a doctor entered them), the emergency contacts and the advance directives. ' +
        "With pdf, also saves the portal's PDF of it into the outbox.",
      inputSchema: { pdf: z.boolean().default(false).describe("Also save the portal's PDF of the summary.") },
    },
    handled((args) => getEmergencySummary(deps, args)),
  );

  server.registerTool(
    "list_appointments",
    {
      title: "Appointments",
      description:
        '"Programările mele": appointments made through the portal at providers that take them, by tab (upcoming: confirmed; waiting: not yet confirmed; past; cancelled), ' +
        "with the date, the service, the doctor, the provider and its address, and how many each tab holds.",
      inputSchema: { tab: z.enum(["upcoming", "waiting", "past", "cancelled"]).default("upcoming"), page, size },
    },
    handled((args) => listAppointments(deps, args)),
  );
};
