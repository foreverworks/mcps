import { makeHandled } from "@foreverworks/mcp-kit";

import { asAppError } from "../domain/errors.js";

/**
 * The envelope for the server's own tools, the ones that span both products.
 * Each product's section already carries its own remedy, so what reaches this
 * one belongs to neither, and the useful next step is the check that covers both.
 */
export const handled = makeHandled({
  asAppError,
  remedyFor: () => "run health: it checks every account in both products and names the fix",
});
