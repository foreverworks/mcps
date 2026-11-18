---
"@foreverworks/mcp-esanatateamea": minor
---

A new server for eSănătateaMea, the patient portal of CNAS: your assistant reads whether you are insured and your service package (`get_insurance`), your prescriptions as prescribed and as released (`list_prescriptions`), the services CNAS paid for (`list_reimbursed_services`), referrals and other medical documents with their PDFs (`list_medical_documents`, `get_medical_document`, `download_medical_document`), your emergency summary (`get_emergency_summary`) and your appointments (`list_appointments`), all `read`. It signs in by itself with your e-mail, password and authenticator code, read from files or a vault MCP server, or through ROeID in your browser; `begin_login`, `complete_login` and `logout` are `write` and change only what the server holds. No tool is `money`.
