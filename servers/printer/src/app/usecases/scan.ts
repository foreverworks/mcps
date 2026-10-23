import { fail, inputError } from "../../domain/errors.js";
import { SCAN_SIZES, type ScanRequest, scanRequestProblem, trimJpeg } from "../../domain/escl.js";
import type { Deps } from "../ports.js";

/**
 * One scan of whatever lies on the glass, saved to the outbox. The request is
 * checked against what the scanner says it can do before anything moves, and
 * the scanner must be idle: a scan started over another one's is refused by
 * most devices halfway through.
 */

export type ScanArgs = {
  readonly resolution: number;
  readonly color: "grey" | "colour";
  readonly format: "pdf" | "jpeg";
  readonly size: "a4" | "letter" | "glass";
  readonly intent?: string | undefined;
};

const stamp = (ms: number): string => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

export const scan = async (deps: Deps, args: ScanArgs) => {
  const caps = await deps.scanner.capabilities();
  const platen = caps.platen ?? fail({ kind: "drift", message: "the scanner describes no flatbed (Platen) in its capabilities" });
  const region = args.size === "glass" ? { width: platen.maxWidth, height: platen.maxHeight } : SCAN_SIZES[args.size];
  const wantedIntent = args.intent ?? (args.color === "colour" ? "Photo" : "Document");
  if (args.intent !== undefined && platen.intents.length > 0 && !platen.intents.includes(args.intent)) {
    return fail(inputError(`the scanner offers the intents ${platen.intents.join(", ")}, not ${args.intent}`));
  }
  const intent = platen.intents.length === 0 || platen.intents.includes(wantedIntent) ? wantedIntent : (platen.intents[0] as string);
  const request: ScanRequest = {
    resolution: args.resolution,
    colorMode: args.color === "colour" ? "RGB24" : "Grayscale8",
    format: args.format === "pdf" ? "application/pdf" : "image/jpeg",
    ...region,
    intent,
  };
  const problem = scanRequestProblem(request, platen);
  if (problem !== undefined) return fail(inputError(problem));

  const status = await deps.scanner.status();
  if (status.state !== "Idle") return fail({ kind: "busy", device: "scanner", message: `the scanner is ${status.state}, not Idle` });

  const scanned = await deps.scanner.scan(request, caps.version ?? "2.0");
  const bytes = args.format === "jpeg" ? trimJpeg(scanned.bytes) : scanned.bytes;
  const looksRight = args.format === "pdf" ? Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-" : bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!looksRight) return fail({ kind: "drift", message: `the scanner sent ${scanned.contentType}, ${bytes.length} bytes, which is not a ${args.format.toUpperCase()}` });
  const saved = await deps.outbox.save(`scan/${stamp(deps.now())}.${args.format === "pdf" ? "pdf" : "jpg"}`, bytes);
  return {
    ...saved,
    format: args.format,
    resolution: args.resolution,
    color: args.color,
    area: args.size,
    region_300ths_inch: region,
    intent,
    ...(bytes.length === scanned.bytes.length ? {} : { trailing_bytes_removed: scanned.bytes.length - bytes.length }),
  };
};
