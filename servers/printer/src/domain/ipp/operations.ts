import {
  type Attributes,
  enumValue,
  firstBoolean,
  firstNumber,
  firstString,
  GROUP,
  groupAttributes,
  integer,
  keyword,
  type Message,
  numbers,
  type OutAttribute,
  type OutGroup,
  strings,
  TAG,
  type Value,
} from "./codec.js";

/**
 * The IPP operations a client of one printer needs (RFC 8011, PWG 5100.12),
 * and what their answers mean, mapped from the wire into this server's words.
 */

export const OPERATION = {
  printJob: 0x0002,
  validateJob: 0x0004,
  cancelJob: 0x0008,
  getJobAttributes: 0x0009,
  getJobs: 0x000a,
  getPrinterAttributes: 0x000b,
} as const;

const STATUS_NAMES: Readonly<Record<number, string>> = {
  0x0000: "successful-ok",
  0x0001: "successful-ok-ignored-or-substituted-attributes",
  0x0002: "successful-ok-conflicting-attributes",
  0x0400: "client-error-bad-request",
  0x0401: "client-error-forbidden",
  0x0402: "client-error-not-authenticated",
  0x0403: "client-error-not-authorized",
  0x0404: "client-error-not-possible",
  0x0405: "client-error-timeout",
  0x0406: "client-error-not-found",
  0x0407: "client-error-gone",
  0x0408: "client-error-request-entity-too-large",
  0x040a: "client-error-document-format-not-supported",
  0x040b: "client-error-attributes-or-values-not-supported",
  0x040c: "client-error-uri-scheme-not-supported",
  0x040d: "client-error-charset-not-supported",
  0x040e: "client-error-conflicting-attributes",
  0x0500: "server-error-internal-error",
  0x0501: "server-error-operation-not-supported",
  0x0502: "server-error-service-unavailable",
  0x0503: "server-error-version-not-supported",
  0x0504: "server-error-device-error",
  0x0505: "server-error-temporary-error",
  0x0506: "server-error-not-accepting-jobs",
  0x0507: "server-error-busy",
  0x0508: "server-error-job-canceled",
};

export const statusName = (code: number): string => STATUS_NAMES[code] ?? `0x${code.toString(16).padStart(4, "0")}`;

export const succeeded = (message: Message): boolean => message.code < 0x0100;

/** The status-message the printer sent with its status code, if any. */
export const statusMessage = (message: Message): string | undefined => firstString(groupAttributes(message, GROUP.operation), "status-message");

const operationGroup = (printerUri: string, extra: readonly OutAttribute[] = []): OutGroup => ({
  tag: GROUP.operation,
  attributes: [
    { name: "attributes-charset", values: [{ tag: TAG.charset, value: "utf-8" }] },
    { name: "attributes-natural-language", values: [{ tag: TAG.naturalLanguage, value: "en" }] },
    { name: "printer-uri", values: [{ tag: TAG.uri, value: printerUri }] },
    ...extra,
  ],
});

export type Request = { readonly operation: number; readonly groups: readonly OutGroup[] };

/** What status reads: state, reasons, supplies, firmware, what the printer takes. */
export const STATUS_ATTRIBUTES = [
  "printer-state",
  "printer-state-reasons",
  "printer-state-message",
  "printer-is-accepting-jobs",
  "queued-job-count",
  "printer-make-and-model",
  "printer-info",
  "printer-up-time",
  "printer-firmware-name",
  "printer-firmware-string-version",
  "media-ready",
  "marker-names",
  "marker-types",
  "marker-colors",
  "marker-levels",
  "marker-low-levels",
  "marker-high-levels",
  "document-format-supported",
  "pwg-raster-document-type-supported",
  "pwg-raster-document-resolution-supported",
  "copies-supported",
] as const;

export const getPrinterAttributes = (printerUri: string, requested: readonly string[]): Request => ({
  operation: OPERATION.getPrinterAttributes,
  groups: [operationGroup(printerUri, [{ name: "requested-attributes", values: requested.map(keyword) }])],
});

export type JobTicket = {
  readonly jobName: string;
  readonly documentFormat: string;
  /** The user the printer files the job under, when the deployment names one. */
  readonly userName?: string;
};

/**
 * Print-Job, one copy, one-sided, monochrome, no scaling: the document is
 * already the page at the printer's resolution, and copies are pages in it.
 */
export const printJob = (printerUri: string, ticket: JobTicket): Request => ({
  operation: OPERATION.printJob,
  groups: [
    operationGroup(printerUri, [
      ...(ticket.userName === undefined ? [] : [{ name: "requesting-user-name", values: [{ tag: TAG.name, value: ticket.userName }] }]),
      { name: "job-name", values: [{ tag: TAG.name, value: ticket.jobName }] },
      { name: "document-format", values: [{ tag: TAG.mimeMediaType, value: ticket.documentFormat }] },
    ]),
    {
      tag: GROUP.job,
      attributes: [
        { name: "copies", values: [integer(1)] },
        { name: "sides", values: [keyword("one-sided")] },
        { name: "print-color-mode", values: [keyword("monochrome")] },
        { name: "print-scaling", values: [keyword("none")] },
        { name: "print-quality", values: [enumValue(4)] },
      ],
    },
  ],
});

const JOB_ATTRIBUTES = ["job-id", "job-name", "job-state", "job-state-reasons", "job-state-message", "job-impressions-completed", "job-media-sheets-completed"];

export const getJobAttributes = (printerUri: string, jobId: number): Request => ({
  operation: OPERATION.getJobAttributes,
  groups: [operationGroup(printerUri, [{ name: "job-id", values: [integer(jobId)] }, { name: "requested-attributes", values: JOB_ATTRIBUTES.map(keyword) }])],
});

export const getJobs = (printerUri: string, which: "not-completed" | "completed", limit: number): Request => ({
  operation: OPERATION.getJobs,
  groups: [
    operationGroup(printerUri, [
      { name: "which-jobs", values: [keyword(which)] },
      { name: "limit", values: [integer(limit)] },
      { name: "requested-attributes", values: JOB_ATTRIBUTES.map(keyword) },
    ]),
  ],
});

export const cancelJob = (printerUri: string, jobId: number): Request => ({
  operation: OPERATION.cancelJob,
  groups: [operationGroup(printerUri, [{ name: "job-id", values: [integer(jobId)] }])],
});

// ---------- answers ----------

const PRINTER_STATES: Readonly<Record<number, string>> = { 3: "idle", 4: "processing", 5: "stopped" };
const JOB_STATES: Readonly<Record<number, JobState>> = {
  3: "pending",
  4: "held",
  5: "processing",
  6: "stopped",
  7: "canceled",
  8: "aborted",
  9: "completed",
};

export type JobState = "pending" | "held" | "processing" | "stopped" | "canceled" | "aborted" | "completed";

export const FINAL_JOB_STATES: ReadonlySet<JobState> = new Set(["canceled", "aborted", "completed"]);

/** The reasons IPP Everywhere printers report most, in a person's words (PWG 5100.9 keywords, severity suffix removed). */
const REASON_MEANINGS: Readonly<Record<string, string>> = {
  "media-empty": "no paper in the tray",
  "media-needed": "the printer is waiting for paper",
  "media-jam": "paper jam",
  "media-low": "paper is running low",
  "toner-low": "toner is low",
  "toner-empty": "toner is empty",
  "marker-supply-low": "a supply is low",
  "marker-supply-empty": "a supply is empty",
  "marker-waste-almost-full": "the waste toner is almost full",
  "marker-waste-full": "the waste toner is full",
  "cover-open": "a cover is open",
  "door-open": "a door is open",
  "input-tray-missing": "a paper tray is missing",
  "output-area-full": "the output tray is full",
  "offline": "the printer is offline",
  "paused": "the printer is paused",
  "shutdown": "the printer is shutting down",
  "stopped-partly": "the printer is partly stopped",
  "developer-low": "the developer is low",
  "developer-empty": "the developer is empty",
  "opc-near-eol": "the drum is near the end of its life",
  "opc-life-over": "the drum has reached the end of its life",
  "fuser-over-temp": "the fuser is too hot",
  "fuser-under-temp": "the fuser is warming up",
  "spool-area-full": "the printer's job memory is full",
  "timed-out": "the printer timed out waiting for data",
  "interpreter-resource-unavailable": "the printer ran out of memory for the job",
  "other": "an unspecified condition",
};

export type Reason = { readonly reason: string; readonly severity?: "report" | "warning" | "error"; readonly meaning?: string };

export const reasonOf = (keywordText: string): Reason => {
  const m = /^(.*)-(report|warning|error)$/.exec(keywordText);
  const reason = m?.[1] ?? keywordText;
  const meaning = REASON_MEANINGS[reason];
  const severity = m?.[2] as "report" | "warning" | "error" | undefined;
  return { reason, ...(severity === undefined ? {} : { severity }), ...(meaning === undefined ? {} : { meaning }) };
};

const reasonsOf = (attributes: Attributes, name: string): readonly Reason[] =>
  strings(attributes, name)
    .filter((r) => r !== "none")
    .map(reasonOf);

export type Supply = {
  readonly name: string;
  readonly type?: string;
  readonly color?: string;
  /** Percent of full, when the printer measures it. */
  readonly levelPercent?: number;
  /** What the printer says instead of a number: some left, or unknown. */
  readonly level?: "some-remaining" | "unknown";
  readonly lowAtPercent?: number;
};

const percentOf = (level: number, high: number | undefined): number => (high !== undefined && high > 0 && high !== 100 ? Math.round((level / high) * 100) : level);

/** marker-* are parallel lists, one entry per supply (RFC 3805's prtMarkerSupplies levels: -3 some remaining, -2 and -1 unknown). */
export const suppliesOf = (attributes: Attributes): readonly Supply[] => {
  const names = strings(attributes, "marker-names");
  const types = strings(attributes, "marker-types");
  const colors = strings(attributes, "marker-colors");
  const levels = numbers(attributes, "marker-levels");
  const lows = numbers(attributes, "marker-low-levels");
  const highs = numbers(attributes, "marker-high-levels");
  return names.map((name, i) => {
    const level = levels[i];
    const high = highs[i];
    const low = lows[i];
    return {
      name,
      ...(types[i] === undefined ? {} : { type: types[i] }),
      ...(colors[i] === undefined ? {} : { color: colors[i] }),
      ...(level === undefined ? {} : level >= 0 ? { levelPercent: percentOf(level, high) } : { level: level === -3 ? "some-remaining" : "unknown" }),
      ...(low === undefined || low < 0 ? {} : { lowAtPercent: percentOf(low, high) }),
    } as Supply;
  });
};

export type PrinterStatus = {
  readonly state: string;
  readonly reasons: readonly Reason[];
  readonly message?: string;
  readonly acceptingJobs?: boolean;
  readonly queuedJobs?: number;
  readonly makeAndModel?: string;
  readonly firmware: readonly { readonly name: string; readonly version: string }[];
  readonly upSeconds?: number;
  readonly mediaReady: readonly string[];
  readonly supplies: readonly Supply[];
  readonly documentFormats: readonly string[];
  readonly pwgRasterTypes: readonly string[];
  readonly pwgRasterDpi: readonly number[];
};

const resolutionsOf = (attributes: Attributes, name: string): readonly number[] =>
  (attributes.get(name) ?? []).flatMap((v: Value) => (v.tag === "resolution" && v.units === "dpi" && v.x === v.y ? [v.x] : []));

export const printerStatusOf = (message: Message): PrinterStatus => {
  const a = groupAttributes(message, GROUP.printer);
  const state = firstNumber(a, "printer-state");
  const names = strings(a, "printer-firmware-name");
  const versions = strings(a, "printer-firmware-string-version");
  const optional = <T>(key: string, value: T | undefined): Record<string, T> => (value === undefined || value === "" ? {} : { [key]: value });
  return {
    state: state === undefined ? "unknown" : (PRINTER_STATES[state] ?? String(state)),
    reasons: reasonsOf(a, "printer-state-reasons"),
    ...optional("message", firstString(a, "printer-state-message")),
    ...optional("acceptingJobs", firstBoolean(a, "printer-is-accepting-jobs")),
    ...optional("queuedJobs", firstNumber(a, "queued-job-count")),
    ...optional("makeAndModel", firstString(a, "printer-make-and-model")),
    firmware: versions.map((version, i) => ({ name: names[i] ?? `firmware ${i + 1}`, version })),
    ...optional("upSeconds", firstNumber(a, "printer-up-time")),
    mediaReady: strings(a, "media-ready"),
    supplies: suppliesOf(a),
    documentFormats: strings(a, "document-format-supported"),
    pwgRasterTypes: strings(a, "pwg-raster-document-type-supported"),
    pwgRasterDpi: resolutionsOf(a, "pwg-raster-document-resolution-supported"),
  };
};

export type JobStatus = {
  readonly jobId: number;
  readonly state: JobState | "unknown";
  readonly reasons: readonly Reason[];
  readonly name?: string;
  readonly message?: string;
  readonly pagesCompleted?: number;
  readonly sheetsCompleted?: number;
};

export const jobStatusOf = (attributes: Attributes, fallbackId?: number): JobStatus => {
  const state = firstNumber(attributes, "job-state");
  const optional = <T>(key: string, value: T | undefined): Record<string, T> => (value === undefined || value === "" ? {} : { [key]: value });
  return {
    jobId: firstNumber(attributes, "job-id") ?? fallbackId ?? 0,
    state: state === undefined ? "unknown" : (JOB_STATES[state] ?? "unknown"),
    reasons: reasonsOf(attributes, "job-state-reasons"),
    ...optional("name", firstString(attributes, "job-name")),
    ...optional("message", firstString(attributes, "job-state-message")),
    ...optional("pagesCompleted", firstNumber(attributes, "job-impressions-completed")),
    ...optional("sheetsCompleted", firstNumber(attributes, "job-media-sheets-completed")),
  };
};

/** Every job group of a Get-Jobs answer. */
export const jobsOf = (message: Message): readonly JobStatus[] => message.groups.filter((g) => g.tag === GROUP.job).map((g) => jobStatusOf(g.attributes));
