import { z } from "zod";

/**
 * A case's status as TSDR's JSON answers it (`GET /casestatus/sn<serial>/info`
 * with `Accept: application/json`), recorded 2026-10-22. Only what this server
 * reads is declared; every other field (correspondence, parties, design codes)
 * passes unread. A case without its status block, or a status without its
 * code, is not this shape: drift.
 */
const text = z.string().nullish();

const event = z.object({
  entryNumber: z.number().nullish(),
  entryCode: text,
  entryDate: text,
  entryDesc: text,
});

const status = z.object({
  serialNumber: z.union([z.number(), z.string()]),
  usRegistrationNumber: text,
  markElement: text,
  status: z.number(),
  extStatusDesc: text,
  statusDate: text,
  filingDate: text,
  usRegistrationDate: text,
  tm5StatusDesc: text,
  dateAbandoned: text,
  dateRenewal: text,
});

export const tsdrCase = z.object({
  trademarks: z.array(z.object({ status, prosecutionHistory: z.array(event).nullish() })).min(1),
});
export type TsdrCase = z.infer<typeof tsdrCase>;
