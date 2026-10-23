import { XMLParser } from "fast-xml-parser";

/**
 * eSCL (Mopria's and Apple's "AirScan"), the scanner half of a network
 * multifunction: ScannerCapabilities and ScannerStatus are XML documents, a
 * scan is a ScanSettings document POSTed to ScanJobs, and the result is
 * fetched from the job's NextDocument. Namespaces vary by firmware, so they
 * are read without their prefixes.
 */

const parser = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true, parseTagValue: false, trimValues: true });

type Node = Readonly<Record<string, unknown>>;

const asList = (v: unknown): readonly unknown[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const child = (n: unknown, key: string): unknown => (typeof n === "object" && n !== null ? (n as Node)[key] : undefined);
const text = (v: unknown): string | undefined => (typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined);
const int = (v: unknown): number | undefined => {
  const t = text(v);
  return t !== undefined && /^\d+$/.test(t) ? Number(t) : undefined;
};

export type ParsedXml<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly problem: string };

const parse = (xml: string, root: string): ParsedXml<Node> => {
  let doc: unknown;
  try {
    doc = parser.parse(xml);
  } catch (cause) {
    return { ok: false, problem: `not XML (${(cause as Error).message})` };
  }
  const node = child(doc, root);
  return typeof node === "object" && node !== null ? { ok: true, value: node as Node } : { ok: false, problem: `no ${root} element` };
};

export type ScanJobInfo = { readonly uri: string; readonly state?: string; readonly imagesCompleted?: number; readonly ageSeconds?: number; readonly reasons: readonly string[] };

export type ScannerStatus = { readonly state: string; readonly jobs: readonly ScanJobInfo[] };

export const scannerStatusOf = (xml: string): ParsedXml<ScannerStatus> => {
  const doc = parse(xml, "ScannerStatus");
  if (!doc.ok) return doc;
  const state = text(doc.value["State"]);
  if (state === undefined) return { ok: false, problem: "ScannerStatus has no State" };
  const jobs = asList(child(doc.value["Jobs"], "JobInfo")).flatMap((j): ScanJobInfo[] => {
    const uri = text(child(j, "JobUri"));
    if (uri === undefined) return [];
    const st = text(child(j, "JobState"));
    const images = int(child(j, "ImagesCompleted"));
    const age = int(child(j, "Age"));
    return [
      {
        uri,
        ...(st === undefined ? {} : { state: st }),
        ...(images === undefined ? {} : { imagesCompleted: images }),
        ...(age === undefined ? {} : { ageSeconds: age }),
        reasons: asList(child(child(j, "JobStateReasons"), "JobStateReason")).flatMap((r) => (text(r) === undefined ? [] : [text(r) as string])),
      },
    ];
  });
  return { ok: true, value: { state, jobs } };
};

export type PlatenCapabilities = {
  /** In 1/300 inch, as eSCL counts. */
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly colorModes: readonly string[];
  readonly formats: readonly string[];
  readonly resolutions: readonly number[];
  readonly intents: readonly string[];
};

export type ScannerCapabilities = { readonly makeAndModel?: string; readonly version?: string; readonly platen?: PlatenCapabilities };

export const scannerCapabilitiesOf = (xml: string): ParsedXml<ScannerCapabilities> => {
  const doc = parse(xml, "ScannerCapabilities");
  if (!doc.ok) return doc;
  const caps = child(doc.value["Platen"], "PlatenInputCaps");
  const profiles = asList(child(child(caps, "SettingProfiles"), "SettingProfile"));
  const all = <T>(pick: (profile: unknown) => readonly T[]): readonly T[] => [...new Set(profiles.flatMap(pick))];
  const make = text(doc.value["MakeAndModel"]);
  const version = text(doc.value["Version"]);
  const maxWidth = int(child(caps, "MaxWidth"));
  const maxHeight = int(child(caps, "MaxHeight"));
  const platen: PlatenCapabilities | undefined =
    caps === undefined || maxWidth === undefined || maxHeight === undefined
      ? undefined
      : {
          maxWidth,
          maxHeight,
          colorModes: all((p) => asList(child(child(p, "ColorModes"), "ColorMode")).flatMap((m) => (text(m) ? [text(m) as string] : []))),
          formats: all((p) => asList(child(child(p, "DocumentFormats"), "DocumentFormat")).flatMap((m) => (text(m) ? [text(m) as string] : []))),
          resolutions: all((p) =>
            asList(child(child(child(p, "SupportedResolutions"), "DiscreteResolutions"), "DiscreteResolution")).flatMap((r) => {
              const x = int(child(r, "XResolution"));
              return x !== undefined && x === int(child(r, "YResolution")) ? [x] : [];
            }),
          ).toSorted((a, b) => a - b),
          intents: asList(child(child(caps, "SupportedIntents"), "Intent")).flatMap((m) => (text(m) ? [text(m) as string] : [])),
        };
  return { ok: true, value: { ...(make === undefined ? {} : { makeAndModel: make }), ...(version === undefined ? {} : { version }), ...(platen === undefined ? {} : { platen }) } };
};

export type ScanRequest = {
  readonly resolution: number;
  readonly colorMode: "Grayscale8" | "RGB24";
  readonly format: "application/pdf" | "image/jpeg";
  /** In 1/300 inch. */
  readonly width: number;
  readonly height: number;
  readonly intent: string;
};

/** Paper sizes in 1/300 inch: A4 is 210 x 297 mm. */
export const SCAN_SIZES = { a4: { width: 2480, height: 3508 }, letter: { width: 2550, height: 3300 } } as const;

const escape = (s: string): string => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The ScanSettings document for one platen scan from the top-left corner. */
export const scanSettingsXml = (r: ScanRequest, version: string): string =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<scan:ScanSettings xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03" xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm">',
    `<pwg:Version>${escape(version)}</pwg:Version>`,
    `<scan:Intent>${escape(r.intent)}</scan:Intent>`,
    "<pwg:ScanRegions><pwg:ScanRegion>",
    `<pwg:Height>${r.height}</pwg:Height>`,
    "<pwg:ContentRegionUnits>escl:ThreeHundredthsOfInches</pwg:ContentRegionUnits>",
    `<pwg:Width>${r.width}</pwg:Width>`,
    "<pwg:XOffset>0</pwg:XOffset>",
    "<pwg:YOffset>0</pwg:YOffset>",
    "</pwg:ScanRegion></pwg:ScanRegions>",
    "<pwg:InputSource>Platen</pwg:InputSource>",
    `<scan:ColorMode>${r.colorMode}</scan:ColorMode>`,
    `<scan:XResolution>${r.resolution}</scan:XResolution>`,
    `<scan:YResolution>${r.resolution}</scan:YResolution>`,
    `<pwg:DocumentFormat>${r.format}</pwg:DocumentFormat>`,
    `<scan:DocumentFormatExt>${r.format}</scan:DocumentFormatExt>`,
    "</scan:ScanSettings>",
  ].join("\n");

/** Why a request does not fit what the scanner says it can do, or undefined. */
export const scanRequestProblem = (r: ScanRequest, caps: PlatenCapabilities): string | undefined => {
  if (!caps.resolutions.includes(r.resolution)) return `the scanner scans at ${caps.resolutions.join(", ")} dpi, not ${r.resolution}`;
  if (caps.colorModes.length > 0 && !caps.colorModes.includes(r.colorMode)) return `the scanner offers ${caps.colorModes.join(", ")}, not ${r.colorMode}`;
  if (caps.formats.length > 0 && !caps.formats.includes(r.format)) return `the scanner writes ${caps.formats.join(", ")}, not ${r.format}`;
  if (r.width > caps.maxWidth || r.height > caps.maxHeight) {
    return `the glass is ${caps.maxWidth} x ${caps.maxHeight} (1/300 in), smaller than ${r.width} x ${r.height}`;
  }
  return undefined;
};

/**
 * A JPEG up to its end-of-image marker. Some scanners send bytes after it
 * (decoders warn and ignore them); a file that ends where the image ends is
 * what anyone opening it expects. Segments are walked by their lengths up to
 * the scan, so an EXIF thumbnail's own end marker is not mistaken for it.
 * Returns the bytes unchanged when they are not a JPEG this can walk.
 */
export const trimJpeg = (bytes: Uint8Array): Uint8Array => {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  let p = 2;
  for (;;) {
    if (p + 1 >= bytes.length || bytes[p] !== 0xff) return bytes;
    const marker = bytes[p + 1] as number;
    if (marker === 0xff) {
      p += 1;
      continue;
    }
    if (marker === 0xd9) return bytes.subarray(0, p + 2);
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      p += 2;
      continue;
    }
    if (p + 3 >= bytes.length) return bytes;
    p += 2 + (((bytes[p + 2] as number) << 8) | (bytes[p + 3] as number));
    if (marker !== 0xda) continue;
    // entropy-coded data: a 0xff in it is stuffing (0xff00) or a restart marker, up to the next marker
    while (p + 1 < bytes.length) {
      if (bytes[p] === 0xff) {
        const next = bytes[p + 1] as number;
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          p += 2;
          continue;
        }
        if (next !== 0xff) break;
      }
      p += 1;
    }
  }
};
