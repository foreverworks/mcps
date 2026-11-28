# @foreverworks/mcp-esanatateamea

## 0.2.0

### Minor Changes

- 18af908: A new server for eSănătateaMea, the patient portal of CNAS: your assistant reads whether you are insured and your service package (`get_insurance`), your prescriptions as prescribed and as released (`list_prescriptions`), the services CNAS paid for (`list_reimbursed_services`), referrals and other medical documents with their PDFs (`list_medical_documents`, `get_medical_document`, `download_medical_document`), your emergency summary (`get_emergency_summary`) and your appointments (`list_appointments`), all `read`. It signs in by itself with your e-mail, password and authenticator code, read from files or a vault MCP server, or through ROeID in your browser; `begin_login`, `complete_login` and `logout` are `write` and change only what the server holds. No tool is `money`.

### Patch Changes

- Updated dependencies [d672e23]
- Updated dependencies [8f76786]
- Updated dependencies [ca27413]
- Updated dependencies [e68c576]
- Updated dependencies [6f9174c]
- Updated dependencies [579dbca]
  - @foreverworks/mcp-kit@0.4.0

## 0.1.0

The first release. Your assistant can read your records on eSănătateaMea, the
patient portal of CNAS: whether you are insured and your service package, the
prescriptions doctors wrote and what pharmacies released, the services CNAS
paid for on your behalf, referrals and other medical documents with their
PDFs, your emergency summary and your appointments. It signs in by itself with
your e-mail, password and authenticator code (from files or a vault MCP
server), or through ROeID in your browser. Every tool reads; the login tools
(`begin_login`, `complete_login`, `logout`) change only what the server holds.
No tool is `money`.
