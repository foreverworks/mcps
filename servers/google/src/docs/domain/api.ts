/**
 * The Docs API's own description of its wire shapes (Google's Discovery
 * document, vendored by scripts/refresh-discovery.ts): what batch_update
 * checks requests against and editors_api_reference reads from.
 */
import type { Discovery } from "../../editors/domain/discovery.js";
import discovery from "./discovery.json" with { type: "json" };

export const DOCS_API: Discovery = discovery;
