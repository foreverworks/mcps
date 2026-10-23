import { z } from "zod";

/**
 * The answer of tmsearch.uspto.gov's search backend, as read on 2026-10-05.
 * Undocumented: these are the fields its own page reads (main bundle,
 * `parseSearchResultSetElastic`), each optional or nullable as the records
 * show them, so a new field changes nothing and a missing one is a gap, not
 * a crash. The envelope is checked strictly: without `hits` nothing can be said.
 */
const text = z.string().nullish();
const texts = z.array(z.string()).nullish();

export const usptoMark = z.object({
  id: z.string(),
  wordmark: text,
  alive: z.boolean().nullish(),
  statusCode: z.number().nullish(),
  statusDescription: text,
  filedDate: text,
  registrationDate: text,
  registrationId: text,
  abandonDate: text,
  cancelDate: text,
  internationalClass: texts,
  ownerName: texts,
  drawingCode: z.union([z.number(), z.string()]).nullish(),
  goodsAndServices: texts,
  translation: text,
});
export type UsptoMark = z.infer<typeof usptoMark>;

export const usptoAnswer = z.object({
  hits: z.object({
    totalValue: z.number(),
    hits: z.array(z.object({ id: z.string(), score: z.number().nullish(), source: usptoMark })),
  }),
});
export type UsptoAnswer = z.infer<typeof usptoAnswer>;
