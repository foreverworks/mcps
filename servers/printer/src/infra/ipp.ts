import type { Printer } from "../app/ports.js";
import { type AppError, drift, fail } from "../domain/errors.js";
import { decodeMessage, encodeRequest, GROUP, groupAttributes, type Message } from "../domain/ipp/codec.js";
import {
  cancelJob,
  getJobAttributes,
  getJobs,
  getPrinterAttributes,
  jobsOf,
  jobStatusOf,
  printJob,
  printerStatusOf,
  type Request,
  STATUS_ATTRIBUTES,
  statusMessage,
  statusName,
  succeeded,
} from "../domain/ipp/operations.js";
import type { DeviceHttp } from "./device.js";

/**
 * The printer over IPP: each operation is one POST of `application/ipp` to
 * the printer's URL. The `printer-uri` attribute is the configured URI as it
 * is (some printers echo the Host they were reached by in their own URIs,
 * which says nothing about where they are).
 */

export type PrinterEndpoint = {
  /** The printer-uri sent in every request, ipp:// or ipps://. */
  readonly printerUri: string;
  /** Where requests go: the same, as http:// or https://. */
  readonly url: URL;
};

const QUICK_MS = 15_000;

export const makeIppPrinter = (endpoint: PrinterEndpoint | AppError, http: DeviceHttp): Printer => {
  let requestId = 0;

  const call = async (request: Request, document?: { readonly blob: Blob; readonly timeoutMs: number }): Promise<Message> => {
    if ("kind" in endpoint) return fail(endpoint);
    requestId = (requestId % 0x7fffffff) + 1;
    const head = encodeRequest({ ...request, requestId });
    const response = await http(endpoint.url, {
      method: "POST",
      headers: { "content-type": "application/ipp", accept: "application/ipp" },
      body: document === undefined ? new Uint8Array(head) : new Blob([new Uint8Array(head), document.blob]),
      timeoutMs: document?.timeoutMs ?? QUICK_MS,
    });
    if (response.status !== 200) {
      return fail({ kind: "printer", status: `http-${response.status}`, message: `the printer answered HTTP ${response.status} to an IPP request` });
    }
    let message: Message;
    try {
      message = decodeMessage(response.body);
    } catch (cause) {
      return fail(drift(`the printer's IPP answer does not decode: ${(cause as Error).message}`));
    }
    if (!succeeded(message)) {
      const said = statusMessage(message);
      return fail({ kind: "printer", status: statusName(message.code), message: `the printer refused: ${statusName(message.code)}${said === undefined ? "" : ` (${said})`}` });
    }
    return message;
  };

  const uri = (): string => ("kind" in endpoint ? "" : endpoint.printerUri);

  return {
    status: async () => printerStatusOf(await call(getPrinterAttributes(uri(), STATUS_ATTRIBUTES))),
    submit: async (ticket, document, timeoutMs) => {
      const answer = await call(printJob(uri(), ticket), { blob: document, timeoutMs });
      const job = jobStatusOf(groupAttributes(answer, GROUP.job));
      return job.jobId > 0 ? job : fail(drift("the printer took the job and named no job-id"));
    },
    job: async (jobId) => jobStatusOf(groupAttributes(await call(getJobAttributes(uri(), jobId)), GROUP.job), jobId),
    jobs: async (which, limit) => jobsOf(await call(getJobs(uri(), which, limit))),
    cancel: async (jobId) => {
      await call(cancelJob(uri(), jobId));
    },
  };
};
