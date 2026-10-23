import type { Pace } from "@foreverworks/mcp-kit";

/**
 * Oblio's documented limits, kept on this side of the wire.
 *
 * "30 de cereri la 100 de secunde pentru cererile care genereaza documente" and
 * "30 de cereri la 10 secunde" for everything else (https://www.oblio.eu/api,
 * Autorizare, 2026-09-28). A burst over either is a 429, which the transport
 * retries with the kit's backoff, but a 429 on an issue is a refused invoice
 * and a wasted round trip; waiting here first costs the same time and nothing
 * else.
 *
 * The kit's `makeThrottle` applies them: any window of W seconds sees at most
 * burst + rate x W requests, and both paces below keep that at Oblio's 30. A
 * stdio copy only sees its own calls; the 429 backoff covers the rest.
 */

/** Generating documents, 30 per 100 s: 10 at once, then one every 5 s (10 + 0.2 x 100 = 30). */
export const ISSUING: Pace = { ratePerSec: 0.2, burst: 10 };
/** Everything else, 30 per 10 s: 10 at once, then two a second (10 + 2 x 10 = 30). */
export const GENERAL: Pace = { ratePerSec: 2, burst: 10 };
