import type { ToolPolicy } from "@foreverworks/mcp-kit";

/**
 * Every tool, classified (packages/mcp-kit, policy.ts).
 *
 * - read: the records, health and the status. The two downloads write a PDF
 *   into this server's own outbox, and nothing at CNAS.
 * - write: the login tools change what the server holds (a begun login, the
 *   session, or none); no money, no document. Cancelling an appointment, the
 *   one change the portal offers a patient that matters, is not offered yet.
 */
export const policy: ToolPolicy = {
  health: { access: "read" },
  session_status: { access: "read" },
  begin_login: { access: "write" },
  complete_login: { access: "write" },
  logout: { access: "write" },
  get_insurance: { access: "read" },
  list_prescriptions: { access: "read" },
  list_reimbursed_services: { access: "read" },
  list_medical_documents: { access: "read" },
  get_medical_document: { access: "read" },
  download_medical_document: { access: "read" },
  get_emergency_summary: { access: "read" },
  list_appointments: { access: "read" },
};
