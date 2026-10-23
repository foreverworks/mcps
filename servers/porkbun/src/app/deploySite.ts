import { annotated, callTool } from "./callTool.js";
import type { Deps } from "./ports.js";

/**
 * Porkbun's limit for one deploy_site call, all files together; one file can
 * be no larger.
 */
export const DEPLOY_MAX_BYTES = 10 * 1024 * 1024;

/** One file to publish: where it goes on the hosting, and where its bytes come from. */
export type SiteFile = {
  /** The destination on the hosting, e.g. `assets/app.css`. */
  readonly path: string;
  readonly localPath?: string | undefined;
  readonly contentBase64?: string | undefined;
  readonly sha256?: string | undefined;
};

/**
 * The vendor's deploy_site, with its files read HERE rather than typed. The
 * vendor's tool takes each file's bytes as base64 in the arguments, which a
 * model would have to reproduce character for character; this one reads each
 * file through the kit's reader (a path inside the file roots, or base64 a
 * script wrote with its sha256), then hands the vendor the base64 of exactly
 * those bytes. The answer adds the sha256 and size of every file sent, so the
 * caller can compare them with the source. A file that cannot be read fails
 * the call before anything is uploaded.
 */
export const deploySite = async (deps: Deps, args: { readonly domain: string; readonly files: readonly SiteFile[] }, revealsSecrets: boolean) => {
  const read = [];
  // One at a time: over stdio each read may ask the client for its roots.
  for (const file of args.files) {
    read.push({ path: file.path, file: await deps.files({ path: file.localPath, contentBase64: file.contentBase64, sha256: file.sha256 }) });
  }
  const files = read.map(({ path, file }) => ({ path, content: file.bytes.toString("base64") }));
  const result = await callTool(deps, "deploy_site", { domain: args.domain, files }, revealsSecrets);
  return annotated(result, { sent_files: read.map(({ path, file }) => ({ path, sha256: file.sha256, size: file.size })) });
};
