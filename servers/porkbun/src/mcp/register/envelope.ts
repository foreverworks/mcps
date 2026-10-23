import { makeHandled } from "@foreverworks/mcp-kit";

import { asAppError, remedyFor } from "../../domain/errors.js";

/** The kit's envelope, taught this server's failures and remedies. */
export const handled = makeHandled({ asAppError, remedyFor });
