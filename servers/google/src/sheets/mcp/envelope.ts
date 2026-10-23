import { makeHandled } from "@foreverworks/mcp-kit";

import { asAppError, remedyFor } from "../domain/errors.js";

/** The shared envelope, taught Sheets' remedies. */
export const handled = makeHandled({ asAppError, remedyFor });
