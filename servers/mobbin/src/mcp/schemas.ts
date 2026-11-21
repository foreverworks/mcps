import { z } from "zod";

import type { ToolSpec } from "../domain/schema.js";

/**
 * The arguments of an upstream tool, as zod: built from the JSON Schema Mobbin
 * published, so a client sees the same fields and limits. A schema zod cannot
 * read, or none seen yet (before the first listing), accepts any object and
 * leaves the checking to Mobbin, whose answer is forwarded as it is.
 */
export const inputSchemaOf = (spec: ToolSpec | undefined): z.ZodType<Record<string, unknown>> => {
  if (spec !== undefined) {
    try {
      const built = z.fromJSONSchema(spec.inputSchema);
      if (built instanceof z.ZodObject) return built as unknown as z.ZodType<Record<string, unknown>>;
    } catch {
      // Falls through to the open schema.
    }
  }
  return z.record(z.string(), z.unknown());
};
