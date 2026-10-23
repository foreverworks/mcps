/**
 * ANAF's wire shapes.
 *
 * GENERATED wherever ANAF publishes a machine-readable document. It does, for
 * every REST endpoint this server calls, in an unusual place: each service has
 * a Swagger UI page on mfinante.gov.ro with its OpenAPI 3.0.1 document embedded
 * in the page. `npm run gen:types` cuts those out (openapi/*.json) and runs
 * openapi-typescript over them (generated/*.ts); each generated file names the
 * page it came from and the date.
 *
 * HAND-MODELLED only where ANAF publishes nothing a machine can read, from the
 * official documents cited beside each type (read 2026-09-28). Those shapes are
 * parsed with zod at the infra boundary (infra/wire.ts), so a drift fails
 * loudly instead of flowing on as `undefined`.
 *
 * The one import in domain/, on purpose: types only, describing the outside
 * world this layer's rules are about.
 */
import type { components as ListaMesaje } from "./generated/efactura-lista-mesaje.js";
import type { components as StareMesaj } from "./generated/efactura-stare-mesaj.js";
import type { components as Transformare } from "./generated/efactura-transformare.js";
import type { components as Upload } from "./generated/efactura-upload.js";
import type { components as Validare } from "./generated/efactura-validare.js";
import type { components as EtransportLista } from "./generated/etransport-lista.js";

/** One row of listaMesajeFactura and listaMesajePaginatieFactura. Generated. */
export type RawMessage = ListaMesaje["schemas"]["Mesaj"];

/**
 * The listing envelope. HAND-MODELLED, because the published document is wrong
 * about it: it declares the 200 body of both listing operations as ONE `Mesaj`,
 * while its own examples ("cif-ul returneaza mesaje", "nu exista mesaje", same
 * document, https://mfinante.gov.ro/static/10/eFactura/listamesaje.html) show
 * this envelope, and every refusal as `{eroare, titlu}` with HTTP 200.
 */
export type RawMessageList = {
  readonly mesaje?: readonly RawMessage[];
  readonly serial?: string;
  readonly cui?: string;
  readonly titlu?: string;
  /** Present instead of `mesaje` when ANAF refuses in a 200. */
  readonly eroare?: string;
};

/** The paginated listing's counters, from the same examples. HAND-MODELLED. */
export type RawPagedMessageList = RawMessageList & {
  readonly numar_inregistrari_in_pagina?: number;
  readonly numar_total_inregistrari_per_pagina?: number;
  readonly numar_total_inregistrari?: number;
  readonly numar_total_pagini?: number;
  readonly index_pagina_curenta?: number;
};

/**
 * /upload's answer: one `<header>` element whose attributes are the result.
 * Generated; the property names are the document's, and its `xml` annotations
 * map them to the attributes (`ExecutionStatus`, `index_incarcare`,
 * `dateResponse`, child `Errors` elements with an `errorMessage` attribute).
 */
export type UploadHeader = Upload["schemas"]["Header"];

/** /stareMesaj's answer (`stare`, `id_descarcare`, `Errors`). Generated. */
export type StatusHeader = StareMesaj["schemas"]["Header"];

/**
 * /descarcare's refusal. HAND-MODELLED: the document types the 200 body as a
 * string (the ZIP), and its own examples show a refusal as this JSON object
 * with the same HTTP 200 (https://mfinante.gov.ro/static/10/eFactura/descarcare.html).
 */
export type DownloadRefusal = { readonly eroare?: string; readonly titlu?: string };

/**
 * The e-Transport listing, `GET /ETRANSPORT/ws/v1/lista/{zile}/{cif}`.
 * Generated from https://mfinante.gov.ro/static/10/eTransport/lista.html. Its
 * rows are declarations (UIT codes, vehicles, trading partners), not e-Factura
 * messages, and a refusal is `Errors` beside `ExecutionStatus: 1`.
 */
export type RawEtransportList = EtransportLista["schemas"]["header"];
export type RawDeclaration = EtransportLista["schemas"]["Mesaj"];

/**
 * What the access token's JWT payload says about itself. HAND-MODELLED: ANAF's
 * OAuth server (logincert.anaf.ro) publishes no schema at all, and the token
 * answer itself is RFC 6749's, read by the kit's OAuth client. Source:
 * "Procedura de inregistrare a aplicatiilor in portalul ANAF",
 * https://static.anaf.ro/static/10/Anaf/Informatii_R/API/Oauth_procedura_inregistrare_aplicatii_portal_ANAF.pdf
 * (read 2026-09-28; pp. 28-29 and 33 also give the 90-day access and 365-day
 * refresh lifetimes, and the 60 seconds an authorization code lives). It says
 * the token "contains information about the application, the user and the
 * access level" and shows `iss` and `exp`; `serial`, `issuer`
 * and `roles` (the certificate's serial and issuer, and the granted roles
 * joined by `@`) are what ANAF's tokens carry beside them. All optional: the
 * token is read for information, never trusted for authorization, and a claim
 * that is missing only leaves a field of token_status empty.
 */
export type AccessTokenClaims = {
  readonly exp?: number | undefined;
  readonly serial?: string | undefined;
  readonly issuer?: string | undefined;
  readonly roles?: string | undefined;
};

/**
 * /validare/{standard}'s answer: `stare` ok or nok, ANAF's findings under
 * `Messages`, and a trace id. Generated from
 * https://mfinante.gov.ro/static/10/eFactura/validare.html. A refusal of the
 * request itself (standard, size) arrives in the same shape with HTTP 200.
 */
export type ValidationAnswer = Validare["schemas"]["header"];

/**
 * /transformare's refusal: the same `header` as /validare, with HTTP 200, when
 * the document fails validation or the request is refused; a PDF otherwise.
 * Generated from https://mfinante.gov.ro/static/10/eFactura/xmltopdf.html.
 */
export type ConversionRefusal = Transformare["schemas"]["header"];

/**
 * /api/validate/signature's answer. HAND-MODELLED: the document
 * (https://mfinante.gov.ro/static/10/eFactura/validaresemnatura.html) types
 * the 200 body as a string, and both of its own examples are this object,
 * the verdict in prose (domain/seal.ts, anafSealVerdict).
 */
export type SealAnswer = { readonly msg?: string };

/**
 * PlatitorTvaRest v9, one company. HAND-MODELLED: ANAF publishes a text file,
 * not a schema (doc_WS_V9.txt, cited in infra/config.ts, read 2026-09-30), and
 * the live answer differs from it in three places, measured the same day: no
 * `cod`/`message` envelope, `perioade_TVA` is a list rather than one object,
 * and `data_inreg_Reg_RO_e_Factura` exists although the document does not name
 * it. A field may also be null (`cod_CAEN` is, for a ministry). Dates are
 * `YYYY-MM-DD` or empty; empty and null both mean "none", never "unknown".
 * Only the fields this server maps are named; the parse drops the rest.
 */
export type RawCompany = {
  readonly date_generale: {
    readonly cui: number;
    readonly data?: string | null;
    readonly denumire?: string | null;
    readonly adresa?: string | null;
    readonly nrRegCom?: string | null;
    readonly telefon?: string | null;
    readonly codPostal?: string | null;
    readonly stare_inregistrare?: string | null;
    readonly data_inregistrare?: string | null;
    readonly cod_CAEN?: string | null;
    readonly iban?: string | null;
    readonly statusRO_e_Factura?: boolean | null;
    readonly data_inreg_Reg_RO_e_Factura?: string | null;
    readonly organFiscalCompetent?: string | null;
    readonly forma_juridica?: string | null;
  };
  readonly inregistrare_scop_Tva?: {
    readonly scpTVA?: boolean | null;
    readonly perioade_TVA?: readonly {
      readonly data_inceput_ScpTVA?: string | null;
      readonly data_sfarsit_ScpTVA?: string | null;
      readonly data_anul_imp_ScpTVA?: string | null;
      readonly mesaj_ScpTVA?: string | null;
    }[];
  };
  readonly inregistrare_RTVAI?: { readonly statusTvaIncasare?: boolean | null; readonly dataInceputTvaInc?: string | null };
  readonly stare_inactiv?: {
    readonly statusInactivi?: boolean | null;
    readonly dataInactivare?: string | null;
    readonly dataReactivare?: string | null;
    readonly dataRadiere?: string | null;
  };
  readonly inregistrare_SplitTVA?: { readonly statusSplitTVA?: boolean | null; readonly dataInceputSplitTVA?: string | null };
  readonly adresa_sediu_social?: {
    readonly sdenumire_Strada?: string | null;
    readonly snumar_Strada?: string | null;
    readonly sdenumire_Localitate?: string | null;
    readonly sdenumire_Judet?: string | null;
    readonly scod_JudetAuto?: string | null;
    readonly scod_Postal?: string | null;
    readonly stara?: string | null;
    readonly sdetalii_Adresa?: string | null;
  };
};

/** The registry's answer: the companies found, and the CUIs it does not know. HAND-MODELLED, as RawCompany. */
export type RawCompanyList = { readonly found?: readonly RawCompany[]; readonly notFound?: readonly number[] };

/**
 * e-Transport's upload answer (`/upload/ETRANSP/{cif}/2`). HAND-MODELLED: the
 * published document types the 200 body as a string, and its examples
 * ("incarcare cu succes v2", "standard invalid", "lipsa drepturi",
 * https://mfinante.gov.ro/static/10/eTransport/upload_param.html, 02.07.2024)
 * show this JSON. `index_incarcare` is a number in them.
 */
export type RawTransportUpload = {
  readonly dateResponse?: string;
  readonly ExecutionStatus: number;
  readonly index_incarcare?: number | string;
  readonly UIT?: string;
  readonly trace_id?: string;
  readonly ref_declarant?: string;
  readonly atentie?: string;
  readonly Errors?: readonly { readonly errorMessage?: string }[];
};

/**
 * e-Transport's `/stareMesaj/{id_incarcare}` answer. HAND-MODELLED from the
 * examples of https://mfinante.gov.ro/static/10/eTransport/stare.html
 * (02.07.2024): `stare` ok, nok, in prelucrare, or "XML cu erori nepreluat de
 * sistem", and `Errors` when refused.
 */
export type RawTransportStatus = {
  readonly stare?: string;
  readonly dateResponse?: string;
  readonly ExecutionStatus?: number;
  readonly trace_id?: string;
  readonly Errors?: readonly { readonly errorMessage?: string }[];
};
