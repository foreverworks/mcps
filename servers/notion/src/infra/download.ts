import { fail } from "../domain/errors.js";
import { MAX_DOWNLOAD_BYTES } from "../domain/files.js";

/** A signed link answers in seconds; a large file over a slow link takes longer. */
const TIMEOUT_MS = 120_000;

const refuse = (status: number, message: string): never => fail({ kind: "api", status, message });

/**
 * A Notion-hosted file's bytes, from the signed link Notion handed out. The
 * link is the grant, so the workspace's token never goes with it. https only,
 * no redirect followed (the egress limit checks the first host alone), and at
 * most `maxBytes`, refused rather than cut.
 */
export const makeDownload =
  ({ timeoutMs = TIMEOUT_MS, maxBytes = MAX_DOWNLOAD_BYTES }: { readonly timeoutMs?: number; readonly maxBytes?: number } = {}) =>
  async (url: string): Promise<Uint8Array> => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return refuse(0, "the file's link is not a URL");
    }
    if (parsed.protocol !== "https:") return refuse(0, `the file's link is ${parsed.protocol}, not https`);
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
    } catch (cause) {
      return refuse(0, `the file could not be fetched from ${parsed.hostname}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    if (!response.ok) {
      await response.body?.cancel();
      return refuse(response.status, response.status === 403 ? "the file's link has expired; read the page again for a fresh one" : `the file host answered ${response.status}`);
    }
    const declared = Number(response.headers.get("content-length") ?? Number.NaN);
    if (declared > maxBytes) {
      await response.body?.cancel();
      return refuse(0, `the file is ${declared} bytes, over the ${maxBytes} this server saves`);
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = response.body?.getReader();
    for (;;) {
      const next = reader === undefined ? { done: true as const, value: undefined } : await reader.read();
      if (next.done) break;
      total += next.value.length;
      if (total > maxBytes) {
        await reader?.cancel();
        return refuse(0, `the file is over the ${maxBytes} bytes this server saves`);
      }
      chunks.push(next.value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  };
