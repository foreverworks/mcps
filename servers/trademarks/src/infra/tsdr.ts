import type { HttpRequest } from "@foreverworks/mcp-kit";
import { z } from "zod";

import type { RecordsPort } from "../app/ports.js";
import { asAppError, driftError, fail, inputError, TSDR_SOURCE } from "../domain/errors.js";
import { documentsIn, toHistory } from "./tsdr/mapping.js";
import { tsdrCase } from "./tsdr/schema.js";

/**
 * US case files through USPTO's official TSDR API (Trademark Status and
 * Document Retrieval, `tsdrapi.uspto.gov/ts/cd`), behind a key sent as
 * `USPTO-API-KEY`. By serial number: a case's status and prosecution history
 * (JSON), its document list (XML), and a filtered bundle of its documents
 * (PDF). USPTO limits a key to 60 reads a minute and 4 document bundles; the
 * two clients here are paced under both.
 */
export const SOURCE = TSDR_SOURCE;
export const TSDR_BASE = "https://tsdrapi.uspto.gov/ts/cd";

const SERIAL = /^\d{8}$/;

/** USPTO's own example in its TSDR documentation: the probe reads its status. */
const PROBE_SERIAL = "78787878";

const serialOf = (id: string): string => {
  const serial = id.trim();
  return SERIAL.test(serial) ? serial : fail(inputError(`"${id}" is not a USPTO serial number (8 digits; TSDR looks marks up by serial, as search_marks lists them)`));
};

/** A 404 from TSDR is a serial it has no case for. */
const named = <T>(serial: string, call: Promise<T>): Promise<T> =>
  call.catch((thrown: unknown) => (asAppError(thrown)?.kind === "not_found" ? fail({ kind: "not_found", message: `TSDR has no case with serial number ${serial}` }) : Promise.reject(thrown)));

export const makeTsdrRecords = (http: HttpRequest, documentsHttp: HttpRequest, base: string = TSDR_BASE): RecordsPort => {
  const root = base.replace(/\/+$/, "");
  const history = async (id: string) => {
    const serial = serialOf(id);
    const body = await named(serial, http<unknown>(`${root}/casestatus/sn${serial}/info`, { headers: { accept: "application/json" } }));
    const parsed = tsdrCase.safeParse(body);
    return parsed.success ? toHistory(parsed.data) : fail(driftError(SOURCE, `the status of ${serial} answered in an unknown shape: ${z.prettifyError(parsed.error).slice(0, 400)}`));
  };
  return {
    office: "US",
    source: SOURCE,
    history,
    documents: async (id) => {
      const serial = serialOf(id);
      return documentsIn(await named(serial, http<string>(`${root}/casedocs/sn${serial}/info`, { headers: { accept: "application/xml" }, as: "text" })));
    },
    bundle: async (id, filter) => {
      const serial = serialOf(id);
      const bytes = await named(
        serial,
        documentsHttp<Uint8Array>(`${root}/casedocs/bundle.pdf`, {
          query: { sn: serial, type: filter.type, fromDate: filter.from, toDate: filter.to },
          headers: { accept: "application/pdf" },
          as: "bytes",
        }),
      );
      if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") fail(driftError(SOURCE, `TSDR's document bundle for ${serial} is not a PDF`));
      return bytes;
    },
    probe: async () => {
      await history(PROBE_SERIAL);
    },
  };
};
