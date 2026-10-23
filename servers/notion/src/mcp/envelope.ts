import { makeHandled, type ToolResult } from "@foreverworks/mcp-kit";

import { asAppError, remedyFor } from "../domain/errors.js";

/**
 * This server's `handled`: the shared envelope, taught this server's
 * vocabulary. The contract lives in @foreverworks/mcp-kit; what is local is
 * `remedyFor`, the one sentence that says what to do about a failure of THIS
 * integration.
 */
export const handled = makeHandled({ asAppError, remedyFor });

export type { ToolResult };
