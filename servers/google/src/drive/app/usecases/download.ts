import { createHash } from "node:crypto";

import { resolveSaveDir } from "@foreverworks/mcp-kit";

import { downloadName, exportPlan, MAX_DOWNLOAD_BYTES } from "../../domain/download.js";
import { shape } from "../../domain/entries.js";
import { apiError, configError, fail, inputError } from "../../domain/errors.js";
import { storedCheck } from "../../domain/upload.js";
import type { Deps } from "../ports.js";
import { targetId } from "./browse.js";

export type DownloadArgs = {
  /** The file: by id, else by path under My Drive. */
  readonly fileId: string;
  readonly path: string;
  /** For a Google file, what to save it as; "" is its default. Refused for a file with bytes of its own. */
  readonly format: string;
  /** A folder inside the downloads folder; "" is that folder itself. */
  readonly saveDir: string;
  /** Defaults to Drive's name, with the export's extension. */
  readonly filename: string;
};

const hex = (algorithm: "md5" | "sha256", bytes: Uint8Array): string => createHash(algorithm).update(bytes).digest("hex");

/**
 * A file off Drive into the downloads folder, byte for byte and proved so: the bytes
 * that came down are hashed and compared with Drive's own checksum before
 * anything is written, so a damaged download is never saved. A Google file
 * has no bytes, so it is exported (a Doc as PDF unless asked otherwise) and
 * reported as exported rather than verified.
 *
 * For a file no local copy has yet, or one known only by its id.
 */
export const downloadFile = async (deps: Deps, args: DownloadArgs) => {
  const downloads = deps.downloads ?? fail(configError("this server has no folder to save downloads in (DRIVE_DOWNLOADS_DIR)"));
  if (args.fileId.trim() === "" && args.path.trim() === "") return fail(inputError("give file_id or path: the file to download"));
  const where = resolveSaveDir(downloads.dir, args.saveDir);
  if (!where.ok) return fail(inputError(where.reason));

  const raw = await deps.drive.get(await targetId(deps, args.fileId.trim(), args.path));
  const file = shape(raw);
  if (file.isFolder) return fail(inputError(`"${file.name}" is a folder; list_folder shows what is in it`));

  if (file.isNative) {
    const plan = exportPlan(file.mimeType, args.format);
    if ("refused" in plan) return fail(inputError(`"${file.name}": ${plan.refused}`));
    const bytes = await deps.drive.exportBytes(file.id, plan.mime);
    if (bytes.length > MAX_DOWNLOAD_BYTES) return fail(inputError(`"${file.name}" exports to ${bytes.length} bytes, over ${MAX_DOWNLOAD_BYTES}`));
    const path = await downloads.save(where.dir, downloadName(args.filename || file.name, plan.ext), bytes);
    return { ...file, path, size: bytes.length, sha256: hex("sha256", bytes), md5: hex("md5", bytes), exportedAs: plan.format };
  }

  if (args.format !== "") {
    return fail(inputError(`"${file.name}" is a ${file.mimeType} with bytes of its own, saved as they are; format is for Docs, Sheets, Slides and Drawings`));
  }
  if (file.bytes !== null && file.bytes > MAX_DOWNLOAD_BYTES) {
    return fail(inputError(`"${file.name}" is ${file.bytes} bytes, over ${MAX_DOWNLOAD_BYTES}`));
  }
  const bytes = await deps.drive.download(file.id);
  const sha256 = hex("sha256", bytes);
  const md5 = hex("md5", bytes);
  const check = storedCheck(raw, { sha256, md5 });
  if ("mismatch" in check) return fail(apiError(200, `the download is not what Drive stores (${check.mismatch}); nothing was saved`));
  const path = await downloads.save(where.dir, downloadName(args.filename || file.name), bytes);
  return {
    ...file,
    path,
    size: bytes.length,
    sha256,
    md5,
    ...("verifiedBy" in check ? { verifiedBy: check.verifiedBy } : { unverified: check.unverified }),
  };
};
