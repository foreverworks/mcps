import { makeHandled } from "@foreverworks/mcp-kit";

import { asAppError, remedyFor } from "../domain/errors.js";

/** This server's `handled`: the shared envelope, taught this server's remedies. */
export const handled = makeHandled({ asAppError, remedyFor });
