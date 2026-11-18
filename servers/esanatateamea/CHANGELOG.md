# @foreverworks/mcp-esanatateamea

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
