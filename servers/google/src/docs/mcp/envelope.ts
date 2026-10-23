import { makeHandled } from "@foreverworks/mcp-kit";

import { asAppError, remedyFor } from "../domain/errors.js";

/** The shared envelope, taught Docs' remedies. */
export const handled = makeHandled({ asAppError, remedyFor });
