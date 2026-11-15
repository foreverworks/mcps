import { issuesText } from "@foreverworks/mcp-kit";
import type { z } from "zod";

import { drift, fail } from "../domain/errors.js";

/** An answer read through its wire shape, or `drift` naming what (`what`) lacked or mistyped which fields. */
export const parseOrDrift = <S extends z.ZodType>(schema: S, answer: unknown, what: string): z.infer<S> => {
  const result = schema.safeParse(answer);
  return result.success ? result.data : fail(drift(`${what}: ${issuesText(result.error)}`));
};
