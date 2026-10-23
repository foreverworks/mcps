import { makeHandled, type ToolResult } from "@foreverworks/mcp-kit";

import { asAppError, loginRemedy, remedyFor } from "../domain/errors.js";

/**
 * This server's `handled`: the shared envelope, taught this server's
 * vocabulary. The login remedy is built once from the deployment's script
 * name (if any), so every `needs_login` says the same thing.
 */
export const vocabularyFor = (loginScript: string | undefined) => {
  const help = loginRemedy(loginScript);
  return { asAppError, remedyFor: (error: Parameters<typeof remedyFor>[0]) => remedyFor(error, help) };
};

export const handledFor = (loginScript: string | undefined) => makeHandled(vocabularyFor(loginScript));

export type { ToolResult };
