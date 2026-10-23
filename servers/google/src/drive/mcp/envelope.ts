import { makeHandled, type ToolResult } from "@foreverworks/mcp-kit";

import { asAppError, remedyFor } from "../domain/errors.js";

/** The shared envelope, taught this server's vocabulary. */
export const handled = makeHandled({ asAppError, remedyFor });

export type { ToolResult };
