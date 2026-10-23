import { z } from "zod";

import type {
  ConversionRefusal,
  DownloadRefusal,
  RawCompanyList,
  RawEtransportList,
  SealAnswer,
  RawMessageList,
  RawPagedMessageList,
  RawTransportStatus,
  RawTransportUpload,
  StatusHeader,
  UploadHeader,
  ValidationAnswer,
} from "../../domain/schema.js";

/**
 * Every ANAF API answer is parsed here, against the types in domain/schema.ts,
 * before anything reads it. `satisfies` ties each schema to its type, so the
 * two cannot drift apart without a compile error; the parse is what makes a
 * drift on ANAF's side fail loudly at the boundary instead of reaching a
 * mapper as `undefined`. Unknown keys are dropped, not refused: ANAF adding a
 * field is not a failure.
 */

const opt = <T extends z.ZodType>(schema: T) => z.exactOptional(schema);

// --- e-Factura listings (JSON) ---------------------------------------------

const message = z.object({
  cif: opt(z.string()),
  data_creare: opt(z.string()),
  detalii: opt(z.string()),
  id: opt(z.string()),
  id_solicitare: opt(z.string()),
  tip: opt(z.string()),
});

export const messageList = z.object({
  mesaje: opt(z.array(message)),
  serial: opt(z.string()),
  cui: opt(z.string()),
  titlu: opt(z.string()),
  eroare: opt(z.string()),
}) satisfies z.ZodType<RawMessageList>;

export const pagedMessageList = messageList.extend({
  numar_inregistrari_in_pagina: opt(z.number()),
  numar_total_inregistrari_per_pagina: opt(z.number()),
  numar_total_inregistrari: opt(z.number()),
  numar_total_pagini: opt(z.number()),
  index_pagina_curenta: opt(z.number()),
}) satisfies z.ZodType<RawPagedMessageList>;

export const downloadRefusal = z.object({ eroare: opt(z.string()), titlu: opt(z.string()) }) satisfies z.ZodType<DownloadRefusal>;

// --- e-Transport listing (JSON) --------------------------------------------

const errorsType = z.object({ errorMessage: opt(z.string()) });

const declaration = z.object({
  cod_decl: opt(z.string()),
  data_creare: opt(z.string()),
  data_transp: opt(z.string()),
  id_incarcare: opt(z.string()),
  mesaje: opt(z.array(z.object({ mesaj: opt(z.string()), tip: opt(z.string()) }))),
  nr_rem1: opt(z.string()),
  nr_rem2: opt(z.string()),
  nr_veh: opt(z.string()),
  pc_cod: opt(z.string()),
  pc_den: opt(z.string()),
  pc_tara: opt(z.string()),
  ref_decl: opt(z.string()),
  sursa: opt(z.string()),
  tip_op: opt(z.string()),
  tr_cod: opt(z.string()),
  tr_den: opt(z.string()),
  tr_tara: opt(z.string()),
  uit: opt(z.string()),
});

export const etransportList = z.object({
  Errors: opt(z.array(errorsType)),
  mesaje: opt(z.array(declaration)),
  serial: opt(z.string()),
  cui: opt(z.string()),
  titlu: opt(z.string()),
  dateResponse: z.string(),
  ExecutionStatus: z.number(),
  trace_id: z.string(),
}) satisfies z.ZodType<RawEtransportList>;

// --- e-Transport's upload and status (JSON) ---------------------------------

export const transportUpload = z.object({
  dateResponse: opt(z.string()),
  // Every documented answer carries it, and it alone says accepted or refused.
  ExecutionStatus: z.number(),
  index_incarcare: opt(z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)])),
  UIT: opt(z.string()),
  trace_id: opt(z.string()),
  ref_declarant: opt(z.string()),
  atentie: opt(z.string()),
  Errors: opt(z.array(errorsType)),
}) satisfies z.ZodType<RawTransportUpload>;

export const transportStatusAnswer = z.object({
  stare: opt(z.string()),
  dateResponse: opt(z.string()),
  ExecutionStatus: opt(z.number()),
  trace_id: opt(z.string()),
  Errors: opt(z.array(errorsType)),
}) satisfies z.ZodType<RawTransportStatus>;

// --- /upload and /stareMesaj (XML, parsed by infra/xml.ts) -----------------

/**
 * The parsed `<header>` element: attributes under `@_`, `Errors` once or
 * repeated. The published documents map their property names to these
 * attributes with `xml` annotations; the transforms below apply exactly that
 * mapping, into the generated types.
 */
const xmlErrors = opt(z.union([z.array(z.object({ "@_errorMessage": opt(z.string()) })), z.object({ "@_errorMessage": opt(z.string()) })]));

const errorsFrom = (
  errors: z.infer<typeof xmlErrors> | undefined,
): { readonly errors?: readonly { readonly errorMessage?: string }[] } =>
  errors === undefined
    ? {}
    : {
        errors: (Array.isArray(errors) ? errors : [errors]).map((e) =>
          e["@_errorMessage"] === undefined ? {} : { errorMessage: e["@_errorMessage"] },
        ),
      };

const digits = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));

export const uploadHeader = z
  .object({
    header: z.object({
      "@_ExecutionStatus": opt(digits),
      "@_index_incarcare": opt(digits),
      "@_dateResponse": opt(z.string()),
      Errors: xmlErrors,
    }),
  })
  .transform(
    ({ header: h }): UploadHeader => ({
      ...(h["@_ExecutionStatus"] === undefined ? {} : { executionStatus: h["@_ExecutionStatus"] }),
      ...(h["@_index_incarcare"] === undefined ? {} : { indexIncarcare: h["@_index_incarcare"] }),
      ...(h["@_dateResponse"] === undefined ? {} : { dateResponse: h["@_dateResponse"] }),
      ...errorsFrom(h.Errors),
    }),
  );

export const statusHeader = z
  .object({
    header: z.object({
      "@_stare": opt(z.string()),
      "@_id_descarcare": opt(z.string()),
      Errors: xmlErrors,
    }),
  })
  .transform(
    ({ header: h }): StatusHeader => ({
      ...(h["@_stare"] === undefined ? {} : { stare: h["@_stare"] }),
      ...(h["@_id_descarcare"] === undefined ? {} : { idDescarcare: h["@_id_descarcare"] }),
      ...errorsFrom(h.Errors),
    }),
  );

// --- /validare and /transformare (JSON) ------------------------------------

export const validationAnswer = z.object({
  stare: z.string(),
  trace_id: z.string(),
  Messages: opt(z.array(z.object({ message: opt(z.string()) }))),
}) satisfies z.ZodType<ValidationAnswer>;

export const conversionRefusal = validationAnswer satisfies z.ZodType<ConversionRefusal>;

// --- /api/validate/signature (JSON) ----------------------------------------

export const sealAnswer = z.object({ msg: opt(z.string()) }) satisfies z.ZodType<SealAnswer>;

// --- PlatitorTvaRest v9 (JSON) ---------------------------------------------

// Any of these may be null on the wire (cod_CAEN is, for a public institution).
const text = opt(z.string().nullable());
const flag = opt(z.boolean().nullable());

/** One period or a list of them: ANAF's document shows the first, its service answers the second. */
const vatPeriod = z.object({
  data_inceput_ScpTVA: text,
  data_sfarsit_ScpTVA: text,
  data_anul_imp_ScpTVA: text,
  mesaj_ScpTVA: text,
});

const company = z.object({
  date_generale: z.object({
    cui: z.number().int(),
    data: text,
    denumire: text,
    adresa: text,
    nrRegCom: text,
    telefon: text,
    codPostal: text,
    stare_inregistrare: text,
    data_inregistrare: text,
    cod_CAEN: text,
    iban: text,
    statusRO_e_Factura: flag,
    data_inreg_Reg_RO_e_Factura: text,
    organFiscalCompetent: text,
    forma_juridica: text,
  }),
  inregistrare_scop_Tva: opt(
    z.object({
      scpTVA: flag,
      perioade_TVA: opt(z.union([z.array(vatPeriod), vatPeriod.transform((p) => [p])])),
    }),
  ),
  inregistrare_RTVAI: opt(z.object({ statusTvaIncasare: flag, dataInceputTvaInc: text })),
  stare_inactiv: opt(z.object({ statusInactivi: flag, dataInactivare: text, dataReactivare: text, dataRadiere: text })),
  inregistrare_SplitTVA: opt(z.object({ statusSplitTVA: flag, dataInceputSplitTVA: text })),
  adresa_sediu_social: opt(
    z.object({
      sdenumire_Strada: text,
      snumar_Strada: text,
      sdenumire_Localitate: text,
      sdenumire_Judet: text,
      scod_JudetAuto: text,
      scod_Postal: text,
      stara: text,
      sdetalii_Adresa: text,
    }),
  ),
});

export const companyList = z.object({
  found: opt(z.array(company)),
  notFound: opt(z.array(z.number().int())),
}) satisfies z.ZodType<RawCompanyList>;
