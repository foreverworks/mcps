import type { Scanner } from "../app/ports.js";
import { type AppError, drift, fail } from "../domain/errors.js";
import { type ParsedXml, scanSettingsXml, scannerCapabilitiesOf, scannerStatusOf } from "../domain/escl.js";
import type { DeviceHttp } from "./device.js";

/**
 * The scanner over eSCL, from its base URL (`https://<device>/eSCL`):
 *
 *   GET  ScannerCapabilities, ScannerStatus
 *   POST ScanJobs (a ScanSettings document)  -> 201, Location: the job
 *   GET  <job>/NextDocument                  -> the scan; 503 while it is still being made
 *
 * A device may name the job by an absolute URL carrying whatever host it was
 * reached by, so only the Location's path is kept and it is fetched from the
 * configured base.
 */

const QUICK_MS = 15_000;
/** How long one scan may take: a colour page at 300 dpi takes the glass well under a minute. */
const SCAN_MS = 180_000;
const RETRY_MS = 1_000;

export const makeEsclScanner = (base: URL | AppError, http: DeviceHttp, sleep: (ms: number) => Promise<void>, now: () => number = Date.now): Scanner => {
  const at = (path: string): URL => {
    if (!(base instanceof URL)) return fail(base);
    return new URL(path.startsWith("/") ? path : `${base.pathname.replace(/\/$/, "")}/${path}`, base);
  };

  const xml = async <T>(path: string, read: (text: string) => ParsedXml<T>): Promise<T> => {
    const url = at(path);
    const response = await http(url, { timeoutMs: QUICK_MS });
    if (response.status !== 200) return fail({ kind: "drift", message: `the scanner answered HTTP ${response.status} for ${path}` });
    const parsed = read(Buffer.from(response.body).toString("utf8"));
    return parsed.ok ? parsed.value : fail(drift(`the scanner's ${path} is not what eSCL describes: ${parsed.problem}`));
  };

  return {
    status: () => xml("ScannerStatus", scannerStatusOf),
    capabilities: () => xml("ScannerCapabilities", scannerCapabilitiesOf),
    scan: async (request, version) => {
      const created = await http(at("ScanJobs"), {
        method: "POST",
        headers: { "content-type": "text/xml" },
        body: scanSettingsXml(request, version),
        timeoutMs: QUICK_MS,
      });
      if (created.status === 503) return fail({ kind: "busy", device: "scanner", message: "the scanner is busy and did not take the scan" });
      if (created.status !== 201) {
        return fail({ kind: "drift", message: `the scanner answered HTTP ${created.status} to a scan request (${Buffer.from(created.body).toString("utf8").slice(0, 200)})` });
      }
      const location = created.headers.get("location");
      if (location === null) return fail(drift("the scanner took the scan and named no job"));
      const job = new URL(location, at("ScanJobs")).pathname.replace(/\/$/, "");
      const deadline = now() + SCAN_MS;
      for (;;) {
        const next = await http(at(`${job}/NextDocument`), { timeoutMs: SCAN_MS });
        if (next.status === 200) return { bytes: next.body, contentType: next.headers.get("content-type") ?? request.format };
        if (next.status !== 503 || now() > deadline) {
          await http(at(job), { method: "DELETE", timeoutMs: QUICK_MS }).catch(() => undefined);
          return next.status === 503
            ? fail({ kind: "busy", device: "scanner", message: `the scan was not ready after ${SCAN_MS / 1000} s; it was cancelled` })
            : fail(drift(`the scanner answered HTTP ${next.status} for the scanned document`));
        }
        await sleep(RETRY_MS);
      }
    },
  };
};
