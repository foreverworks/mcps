---
"@foreverworks/mcp-glovo": patch
---

Glovo sign-in works again. Glovo started answering `403` to the token refresh, even for a brand-new token, because the request's headers no longer matched those of its own web app. The server now sends the web app's full set on the refresh and on every call: the API version, the app's context and development state, a real app version (also inside the client info), the request time limit, the session id under both names the app uses, and the browser's `Accept`, `Accept-Language`, `Origin`, `Referer` and `User-Agent`. The app version is built in; set `GLOVO_APP_VERSION` to a newer one if Glovo starts refusing the built-in release.
