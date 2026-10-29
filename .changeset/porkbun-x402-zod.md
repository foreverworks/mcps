---
"@foreverworks/mcp-porkbun": patch
---

The Porkbun server's `@x402/core` and `@x402/evm` (through `@porkbunllc/mcp-server`) resolve to 2.29.0, which validates with zod 4.6.7 instead of a zod 3 of its own: zod before 4.6.6 could exhaust memory validating an oversized constrained collection (GHSA-mrhx-c7xc-m3w5). The desktop bundle and a clone built from this repository carry it. Tools and their arguments are unchanged.
