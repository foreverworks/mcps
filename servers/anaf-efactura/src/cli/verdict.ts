import { makeFailureVerdict } from "@foreverworks/mcp-kit";

import { asAppError, needsHuman, remedyFor } from "../domain/errors.js";

/**
 * The kit's verdict line (packages/mcp-kit, verdict.ts), taught this server's
 * vocabulary: every line starts with `ANAF:`, and an OAuth failure leads with
 * ANAF's code, because its description is often just "Bad Request".
 *
 * No line ever carries token material: they are built from expiry dates,
 * roles and error messages, never from a bundle's token fields.
 */
export const failureVerdict = makeFailureVerdict({
  prefix: "ANAF",
  asAppError,
  needsHuman,
  remedyFor,
  labelOf: (error) => (error.kind === "auth" ? `${error.code}: ${error.message}` : error.message),
});
