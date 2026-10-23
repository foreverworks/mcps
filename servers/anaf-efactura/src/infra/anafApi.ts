import { randomUUID } from "node:crypto";

import { issuesText, makePacer, type Query, type RequestSpec } from "@foreverworks/mcp-kit";
import type { z } from "zod";

import type { AnafPort, Receipt } from "../app/ports.js";
import { looksLikeZip } from "../domain/archive.js";
import { apiError, fail, OUTCOME_UNKNOWN } from "../domain/errors.js";
import { flagParams } from "../domain/upload.js";
import { looksLikePdf } from "../domain/validation.js";
import { ANAF_PUBLIC, type Endpoints } from "./config.js";
import { preview, type Request } from "./http.js";
import { greetingOf } from "./anafApi/greeting.js";
import {
  companyList,
  conversionRefusal,
  downloadRefusal,
  etransportList,
  messageList,
  pagedMessageList,
  sealAnswer,
  statusHeader,
  transportStatusAnswer,
  transportUpload,
  uploadHeader,
  validationAnswer,
} from "./anafApi/wire.js";
import { parseXml } from "./xml.js";

const XML = "application/xml";
const JSON_ACCEPT = "application/json";
/** What /validare and /transformare declare they take (validare.html, xmltopdf.html). */
const PLAIN = "text/plain";

/** PlatitorTvaRest's limit: one request a second per client (doc_WS_V9.txt, rule a). */
const REGISTRY_GAP_MS = 1_000;

/** The answer less its `cui`, which on a real response is the certificate holder's CNP: never echoed, on a drift either. */
const withoutCui = (value: unknown): unknown =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== "cui")) : value;

/** A JSON answer against its published shape: a drift fails here, naming the endpoint. */
const parsed = <S extends z.ZodType>(schema: S, value: unknown, url: string): z.output<S> => {
  const result = schema.safeParse(value);
  return result.success
    ? result.data
    : fail(apiError(200, `${url} answered in a shape ANAF does not document: ${issuesText(result.error)}`, { body: withoutCui(value) }));
};

/**
 * An XML `<header>` answer, typed. `onDrift` is the failure to raise when it
 * cannot be read: for a status check that is an ordinary API error, and for an
 * upload it is OUTCOME_UNKNOWN, because ANAF answered 200 and may have filed.
 */
const receipt = <H>(schema: z.ZodType<H>, raw: string, url: string, reason: string | undefined): Receipt<H> => {
  const tree = parseXml(raw);
  const header = tree.ok ? schema.safeParse(tree.tree) : undefined;
  if (header?.success) return { header: header.data, raw };
  return fail(
    apiError(200, `${url} answered, but not with the documented <header>${tree.ok ? "" : ` (${tree.why})`}`, {
      reason,
      body: preview(raw),
    }),
  );
};

/**
 * The only module that knows ANAF's URLs and parameter names.
 *
 * The Romanian names are kept verbatim (`zile`, `pagina`, `filtru`,
 * `id_incarcare`) because they are what the official documentation and every
 * error message call them; translating them here would make the two impossible
 * to line up when something fails.
 *
 * Endpoints arrive as a thunk because they come from app.json, which is read on
 * first use rather than at startup: a missing config should surface as one tool
 * saying so, not as a server that died before it could be asked. The public
 * services (validation, PDF, the VAT registry) are ANAF_PUBLIC's constants and
 * go through `publicRequest`, which carries no token: they need neither
 * app.json nor a live grant.
 */
export const makeAnafApi = (endpoints: () => Promise<Endpoints>, request: Request, publicRequest: Request): AnafPort => {
  const paced = makePacer(REGISTRY_GAP_MS);
  // /validare, /transformare and the registry are POSTs that change nothing, so
  // repeating one after a 5xx or a dropped connection is harmless.
  const post = <T>(url: string, spec: RequestSpec): Promise<T> => publicRequest<T>(url, { ...spec, method: "POST", idempotent: true });

  const fctel = async (test: boolean): Promise<string> => {
    const e = await endpoints();
    return test ? e.fctelTest : e.fctelProd;
  };
  const etransport = async (test: boolean): Promise<string> => {
    const e = await endpoints();
    return test ? e.etransportTest : e.etransportProd;
  };

  const text = (url: string, spec: RequestSpec): Promise<string> => request<string>(url, { ...spec, as: "text" });
  // FCTEL's listings answer JSON, except when they answer an HTML error page
  // with HTTP 200: the kit fails that as not_json, naming the request.
  const json = (url: string, query: Query): Promise<unknown> => request<unknown>(url, { query, headers: { Accept: JSON_ACCEPT } });

  return {
    // The answer echoes the request headers, the bearer token among them: only a
    // checked first line leaves this module (anafApi/greeting.ts).
    hello: async (name) => greetingOf(await text((await endpoints()).hello, { query: { name }, headers: { Accept: "*/*" } })),

    listMessages: async ({ cif, zile, test }) => {
      const url = `${await fctel(test)}/listaMesajeFactura`;
      return parsed(messageList, await json(url, { zile, cif }), url);
    },

    listMessagesPaginated: async ({ cif, startTimeMs, endTimeMs, pagina, filtru, test }) => {
      const url = `${await fctel(test)}/listaMesajePaginatieFactura`;
      const query = { startTime: startTimeMs, endTime: endTimeMs, cif, pagina, filtru };
      return parsed(pagedMessageList, await json(url, query), url);
    },

    downloadMessage: async (id, test) => {
      const url = `${await fctel(test)}/descarcare`;
      const bytes = Buffer.from(
        await request<Uint8Array>(url, { query: { id }, headers: { Accept: "application/zip" }, as: "bytes" }),
      );
      if (looksLikeZip(bytes)) return { bytes, refusal: undefined };
      // Not an archive: ANAF's documented refusal is JSON with the same 200.
      // Anything else stays unexplained, and the use case says so.
      const refusal = ((): z.output<typeof downloadRefusal> | undefined => {
        try {
          const r = downloadRefusal.safeParse(JSON.parse(bytes.toString("utf8")));
          return r.success ? r.data : undefined;
        } catch {
          return undefined;
        }
      })();
      return { bytes, refusal };
    },

    // POST is not idempotent in the kit's loop: a transport error or a 5xx is
    // reported as OUTCOME_UNKNOWN and never resent. A filing twice is worse
    // than a filing that has to be checked.
    // /uploadb2c takes the same parameters and answers the same header (upload.html).
    uploadInvoice: async ({ cif, xml, standard, flags, test, b2c }) => {
      const url = `${await fctel(test)}/${b2c ? "uploadb2c" : "upload"}`;
      const answer = await text(url, {
        method: "POST",
        query: { standard, cif, ...flagParams(flags) },
        body: { contentType: XML, data: new Uint8Array(xml) },
        headers: { Accept: XML },
      });
      return receipt(uploadHeader, answer, url, OUTCOME_UNKNOWN);
    },

    uploadStatus: async (idIncarcare, test) => {
      const url = `${await fctel(test)}/stareMesaj`;
      const answer = await text(url, { query: { id_incarcare: idIncarcare }, headers: { Accept: XML } });
      return receipt(statusHeader, answer, url, undefined);
    },

    // Path parameters, not a query: `/lista/{zile}/{cif}`. Both are validated
    // digits by the time they get here, so they need no encoding.
    etransportList: async ({ cif, zile, test }) => {
      const url = `${await etransport(test)}/lista/${zile}/${cif}`;
      return parsed(etransportList, await json(url, {}), url);
    },

    // e-Transport's upload, v2 form (etransport_29072024.pdf, upload_param.html):
    // POST /upload/ETRANSP/{cif}/2, the declaration as application/xml, a JSON
    // answer. Not idempotent: a transport error or a 5xx is OUTCOME_UNKNOWN in
    // the kit's loop, and so is a 200 that is not the documented JSON, read
    // here from text, because ANAF may have filed it either way.
    fileTransport: async ({ cif, xml, test }) => {
      const url = `${await etransport(test)}/upload/ETRANSP/${cif}/2`;
      const answer = await text(url, { method: "POST", body: { contentType: XML, data: new Uint8Array(xml) }, headers: { Accept: JSON_ACCEPT } });
      const body = ((): unknown => {
        try {
          return JSON.parse(answer);
        } catch {
          return undefined;
        }
      })();
      const read = transportUpload.safeParse(body);
      return read.success
        ? read.data
        : fail(apiError(200, `${url} answered, but not with the documented JSON`, { reason: OUTCOME_UNKNOWN, body: preview(answer) }));
    },

    transportStatus: async (idIncarcare, test) => {
      const url = `${await etransport(test)}/stareMesaj/${idIncarcare}`;
      return parsed(transportStatusAnswer, await json(url, {}), url);
    },

    validate: async (xml, standard) => {
      const url = `${ANAF_PUBLIC.fctel}/validare/${standard}`;
      return parsed(validationAnswer, await post(url, { body: { contentType: PLAIN, data: xml }, headers: { Accept: JSON_ACCEPT } }), url);
    },

    // A PDF when it converts, and the /validare header with the same HTTP 200
    // when it will not. `/DA` is ANAF's "do not validate first".
    convert: async (xml, standard, validate) => {
      const url = `${ANAF_PUBLIC.fctel}/transformare/${standard}${validate ? "" : "/DA"}`;
      const bytes = Buffer.from(
        await post<Uint8Array>(url, {
          body: { contentType: PLAIN, data: xml },
          headers: { Accept: "application/pdf, application/json" },
          as: "bytes",
        }),
      );
      if (looksLikePdf(bytes)) return { pdf: bytes };
      const refusal = ((): unknown => {
        try {
          return JSON.parse(bytes.toString("utf8"));
        } catch {
          return undefined;
        }
      })();
      const read = conversionRefusal.safeParse(refusal);
      return read.success
        ? { refusal: read.data }
        : fail(apiError(200, `${url} answered with neither a PDF nor its documented refusal`, { body: preview(bytes.subarray(0, 600).toString("utf8")) }));
    },

    // multipart/form-data with the two files ANAF names `file` (the invoice)
    // and `signature` (its seal), each sent as the exact bytes it arrived as:
    // the digest is over the raw file.
    verifySeal: async (invoice, seal) => {
      const url = ANAF_PUBLIC.signature;
      const boundary = `----anaf-seal-${randomUUID()}`;
      const part = (name: string, filename: string, bytes: Buffer): Buffer =>
        Buffer.concat([
          Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: text/xml\r\n\r\n`),
          bytes,
          Buffer.from("\r\n"),
        ]);
      const body = Buffer.concat([part("file", "factura.xml", invoice), part("signature", "semnatura.xml", seal), Buffer.from(`--${boundary}--\r\n`)]);
      return parsed(
        sealAnswer,
        await post(url, { body: { contentType: `multipart/form-data; boundary=${boundary}`, data: new Uint8Array(body) }, headers: { Accept: JSON_ACCEPT } }),
        url,
      );
    },

    // `cui` is a number on the wire; the CIFs are validated digits by now.
    companies: (cifs, asOf) =>
      paced(async () => {
        const url = ANAF_PUBLIC.vatRegistry;
        return parsed(companyList, await post(url, { json: cifs.map((cui) => ({ cui: Number(cui), data: asOf })) }), url);
      }),
  };
};
