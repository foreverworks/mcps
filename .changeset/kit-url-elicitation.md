---
"@foreverworks/mcp-kit": minor
"@foreverworks/mcp-google": minor
"@foreverworks/mcp-onrc": minor
"@foreverworks/mcp-anaf-efactura": minor
---

Sign-in links now reach you the standard way where your client supports it. `begin_consent` (google), `begin_login` (onrc) and `begin_authorization` (anaf-efactura) ask the client to offer the sign-in page to you itself, an MCP URL elicitation, with one line saying what to do there and what to bring back. Once you accept, the result no longer carries the URL and only asks for the address the browser lands on; decline, and the URL stays in the result to open elsewhere or pass on. A client without URL elicitation, or a server reached over HTTP, gets the URL in the result as before. Access classes are unchanged.

For server authors, the kit adds `offerLink({ url, message, next })`: call it beside a result that hands a person a link, and the guard offers it through the client where it can. The audit line gains `link` for such calls.
