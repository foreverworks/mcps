---
"@foreverworks/mcp-glovo": patch
---

A Glovo refresh token copied with its quotes no longer breaks sign-in. The web app now stores `glovo_refresh_token` JSON-encoded, so the README's console snippet copied the token wrapped in literal double quotes, and Glovo answered the refresh with `400 bad_request`. The snippet now unwraps the value, the server unwraps a refresh token that a `credentials.json` already holds in quotes, and a `400 bad_request` on the refresh now says a token with its surrounding quotes is refused that way.
