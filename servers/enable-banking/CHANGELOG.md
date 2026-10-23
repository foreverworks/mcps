# @foreverworks/mcp-enable-banking

## 1.0.0

The first release. Your bank accounts through Enable Banking, a licensed PSD2 provider: statements searched across accounts by text, direction and amount, exported as CSV, balances, and the consents themselves with the date each one ends. Amounts stay exact decimal strings from the bank to the answer.

Nothing here moves money out of an account. Its one `money` tool is `start_auth`, because a new consent is a legal agreement with your bank; a client that honours the confirmation mark asks you before every call. Its `write` tools finish a consent (`complete_auth`) and end one (`revoke_session`).
