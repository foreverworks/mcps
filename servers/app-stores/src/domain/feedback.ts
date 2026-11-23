/**
 * TestFlight feedback as App Store Connect keeps it: what a tester sent from
 * the TestFlight app, with a screenshot or after a crash, and the build and
 * device it came from.
 */
export type FeedbackKind = "crash" | "screenshot";

export type Screenshot = { readonly url: string; readonly width: number | null; readonly height: number | null; readonly expiresAt: string | null };

export type Feedback = {
  readonly id: string;
  readonly kind: FeedbackKind;
  readonly at: string;
  /** What the tester wrote; null when they sent none. */
  readonly comment: string | null;
  /** The tester's e-mail, as TestFlight passes it on; null when withheld. */
  readonly tester: string | null;
  readonly device: { readonly model: string | null; readonly os: string | null; readonly platform: string | null };
  /** The build it came from: its build number, and the bundle id it was built as. */
  readonly build: { readonly id: string | null; readonly number: string | null; readonly bundleId: string | null };
  readonly locale?: string;
  /** Screenshot feedback: the images, at URLs that expire. */
  readonly screenshots?: readonly Screenshot[];
};

/** Newest first, across kinds: what a person reads as one inbox. */
export const newestFirst = (items: readonly Feedback[]): readonly Feedback[] => [...items].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

/** The first lines of a crash log, which name the exception and the crashed thread in either of Apple's formats. */
export const headOf = (log: string, lines = 40): readonly string[] => log.split(/\r?\n/).slice(0, lines);

/**
 * The part of a crash log that says why the app died: the exception lines,
 * Application Specific Information, the Last Exception Backtrace and the
 * crashed thread's frames. Reads Apple's text format ("Triggered by Thread: 2",
 * "Thread 2 Crashed:") and its JSON .ips format (a JSON header line, then the
 * report with faultingThread). Null when the log is in neither shape.
 */
export type CrashFocus = {
  readonly format: "text" | "ips";
  readonly exception: readonly string[];
  readonly crashedThread: number | null;
  readonly applicationSpecific?: readonly string[];
  readonly lastExceptionBacktrace?: readonly string[];
  readonly crashedThreadFrames?: readonly string[];
};

const EXCEPTION_LINE = /^(Exception Type|Exception Codes|Exception Subtype|Exception Reason|Exception Message|Termination Reason|Termination Description|Triggered by Thread|Crashed Thread):/;

/** The lines after a header line up to the next blank line, without the header. */
const blockAfter = (lines: readonly string[], header: (line: string) => boolean): readonly string[] | undefined => {
  const at = lines.findIndex(header);
  if (at < 0) return undefined;
  const end = lines.findIndex((l, i) => i > at && l.trim() === "");
  return lines.slice(at + 1, end < 0 ? lines.length : end);
};

const textFocus = (lines: readonly string[]): CrashFocus | null => {
  const exception = lines.filter((l) => EXCEPTION_LINE.test(l)).map((l) => l.trim());
  const triggered = exception.map((l) => /^(?:Triggered by|Crashed) Thread:\s*(\d+)/.exec(l)).find((m) => m !== null);
  const crashedAt = lines.findIndex((l) => /^Thread \d+ Crashed:/.test(l));
  const thread = triggered ? Number(triggered[1]) : crashedAt >= 0 ? Number(/^Thread (\d+)/.exec(lines[crashedAt] ?? "")?.[1]) : null;
  if (exception.length === 0 && thread === null) return null;
  const frames = thread === null ? undefined : blockAfter(lines, (l) => l === `Thread ${thread}:` || l.startsWith(`Thread ${thread} Crashed:`));
  const named = thread === null ? undefined : lines.find((l) => l.startsWith(`Thread ${thread} name:`));
  const asi = blockAfter(lines, (l) => l.startsWith("Application Specific Information:"));
  const leb = blockAfter(lines, (l) => l.startsWith("Last Exception Backtrace:"));
  return {
    format: "text",
    exception,
    crashedThread: thread,
    ...(asi === undefined ? {} : { applicationSpecific: asi }),
    ...(leb === undefined ? {} : { lastExceptionBacktrace: leb }),
    ...(frames === undefined ? {} : { crashedThreadFrames: named === undefined ? frames : [named.trim(), ...frames] }),
  };
};

type IpsFrame = { readonly imageIndex?: number; readonly imageOffset?: number; readonly symbol?: string; readonly symbolLocation?: number; readonly sourceFile?: string; readonly sourceLine?: number };
type IpsReport = {
  readonly faultingThread?: number;
  readonly exception?: Record<string, unknown>;
  readonly termination?: Record<string, unknown>;
  readonly asi?: Record<string, readonly string[]>;
  readonly threads?: readonly { readonly name?: string; readonly queue?: string; readonly frames?: readonly IpsFrame[] }[];
  readonly lastExceptionBacktrace?: readonly IpsFrame[];
  readonly usedImages?: readonly { readonly name?: string }[];
};

const ipsFocus = (text: string): CrashFocus | null => {
  const nl = text.indexOf("\n");
  if (!text.trimStart().startsWith("{") || nl < 0) return null;
  let report: IpsReport;
  try {
    report = JSON.parse(text.slice(nl + 1)) as IpsReport;
  } catch {
    return null;
  }
  if (typeof report !== "object" || report === null || !Array.isArray(report.threads)) return null;
  const frame = (f: IpsFrame, i: number): string => {
    const image = f.imageIndex === undefined ? "?" : (report.usedImages?.[f.imageIndex]?.name ?? `image ${f.imageIndex}`);
    const where = f.symbol === undefined ? `+ ${f.imageOffset ?? "?"}` : `${f.symbol} + ${f.symbolLocation ?? 0}`;
    const source = f.sourceFile === undefined ? "" : ` (${f.sourceFile}:${f.sourceLine ?? "?"})`;
    return `${i} ${image} ${where}${source}`;
  };
  const thread = typeof report.faultingThread === "number" ? report.faultingThread : null;
  const t = thread === null ? undefined : report.threads[thread];
  const label = t === undefined ? [] : [[t.name, t.queue].filter((x) => x !== undefined).join(" / ")].filter((x) => x !== "");
  return {
    format: "ips",
    exception: [report.exception, report.termination].filter((x) => x !== undefined).map((x) => JSON.stringify(x)),
    crashedThread: thread,
    ...(report.asi === undefined ? {} : { applicationSpecific: Object.entries(report.asi).flatMap(([k, v]) => v.map((line) => `${k}: ${line}`)) }),
    ...(report.lastExceptionBacktrace === undefined ? {} : { lastExceptionBacktrace: report.lastExceptionBacktrace.map(frame) }),
    ...(t?.frames === undefined ? {} : { crashedThreadFrames: [...label, ...t.frames.map(frame)] }),
  };
};

export const crashFocus = (log: string): CrashFocus | null => ipsFocus(log) ?? textFocus(log.split(/\r?\n/));

/** Lines from..from+count-1 of a log, 1-based, as the reader pages through it. */
export const linesOf = (log: string, from: number, count: number): readonly string[] => log.split(/\r?\n/).slice(from - 1, from - 1 + count);
