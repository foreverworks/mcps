import { z } from "zod";

/**
 * EUIPO Trademark Search 1.1.0 (dev.euipo.europa.eu, the spec downloaded
 * 2026-10-05), the fields this server reads. Status and kind are kept as
 * strings rather than the spec's enums, so a status EUIPO adds tomorrow is
 * shown as it is instead of failing the search.
 */
const person = z.object({ name: z.string().nullish() });

export const euipoItem = z.object({
  applicationNumber: z.string(),
  markFeature: z.string().nullish(),
  markBasis: z.string().nullish(),
  niceClasses: z.array(z.number()).nullish(),
  wordMarkSpecification: z.object({ verbalElement: z.string() }).nullish(),
  applicants: z.array(person).nullish(),
  applicationDate: z.string().nullish(),
  registrationDate: z.string().nullish(),
  expiryDate: z.string().nullish(),
  status: z.string(),
});
export type EuipoItem = z.infer<typeof euipoItem>;

export const euipoPage = z.object({ trademarks: z.array(euipoItem), totalElements: z.number() });

const goods = z.object({
  classNumber: z.number(),
  description: z.array(z.object({ language: z.string(), terms: z.array(z.string()) })).nullish(),
});

export const euipoDetail = euipoItem.extend({
  statusDate: z.string().nullish(),
  goodsAndServices: z.array(goods).nullish(),
});
export type EuipoDetail = z.infer<typeof euipoDetail>;
