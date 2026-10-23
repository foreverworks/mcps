import type { Pace } from "@foreverworks/mcp-kit";

/**
 * Notion's rate limit, kept on this side of the wire: per integration, a
 * fixed 60-second window of 180 requests on the Free plan (600 on Business and
 * Enterprise), plus a workspace-wide limit it does not publish
 * (https://developers.notion.com/page/changelog, 2026-09-28). A burst over it
 * is a 429 the transport retries with the kit's backoff; waiting here first
 * costs the same time and no refused request.
 *
 * The bucket admits `burst` at once and then `ratePerSec`, so any window of W
 * seconds sees at most burst + rate x W requests: 30 + 2.5 x 60 = 180. The
 * bucket waits in whole seconds (it was made for Retry-After), so past the
 * burst the requests go in small clumps; that is never faster than the rate. One
 * bucket per workspace, because each has its own integration and its own 180.
 * Per process: under a service, that is every session it serves.
 *
 * The kit's `makeThrottle` applies it.
 */

/** 180 per fixed minute, the Free plan's: 30 at once, then 2.5 a second (30 + 2.5 x 60 = 180). */
export const NOTION_FREE: Pace = { ratePerSec: 2.5, burst: 30 };
