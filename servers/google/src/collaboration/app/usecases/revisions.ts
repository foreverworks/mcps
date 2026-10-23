import { createHash } from "node:crypto";

import { resolveSaveDir } from "@foreverworks/mcp-kit";

import { downloadName, exportPlan, MAX_DOWNLOAD_BYTES } from "../../../drive/domain/download.js";
import { shape } from "../../../drive/domain/entries.js";
import { fileIdFrom } from "../../../editors/domain/ids.js";
import { apiError, configError, fail, inputError, notFoundError } from "../../domain/errors.js";
import { revisionView } from "../../domain/view.js";
import type { Deps } from "../ports.js";

const hex = (algorithm: "md5" | "sha256", bytes: Uint8Array): string => createHash(algorithm).update(bytes).digest("hex");

/** The formats a Google file's revision can be saved as: those its export links offer, by the names download takes. */
const formatsOf = (fileMime: string, links: Readonly<Record<string, string>> | null | undefined): readonly string[] =>
  Object.keys(links ?? {}).length === 0
    ? []
    : ["pdf", "docx", "odt", "rtf", "txt", "md", "html", "epub", "xlsx", "ods", "csv", "tsv", "pptx", "odp", "png", "svg", "jpg"].filter((f) => {
        const plan = exportPlan(fileMime, f);
        return !("refused" in plan) && links?.[plan.mime] !== undefined;
      });

/** A file's revisions, oldest first: who changed it when, and for a Google file the formats an old one can be saved as. */
export const listRevisions = async (deps: Deps, args: { readonly fileId: string }) => {
  const id = fileIdFrom(args.fileId);
  const [raw, revisions] = await Promise.all([deps.drive.drive.get(id), deps.drive.drive.listRevisions(id)]);
  const file = shape(raw);
  return {
    fileId: id,
    name: file.name,
    mimeType: file.mimeType,
    revisions: revisions.map((r) => revisionView(r, file.isNative ? formatsOf(file.mimeType, r.exportLinks) : [])),
  };
};

export type DownloadRevisionArgs = { readonly fileId: string; readonly revisionId: string; readonly format: string; readonly saveDir: string; readonly filename: string };

/**
 * One revision into the downloads folder. A file with bytes comes down as it
 * was and is checked against the revision's MD5; a Google file has none, so
 * the revision is exported (a Doc as PDF unless asked) from the link Drive
 * lists for it, and reported as exported.
 */
export const downloadRevision = async (deps: Deps, args: DownloadRevisionArgs) => {
  const downloads = deps.drive.downloads ?? fail(configError("this server has no folder to save downloads in (DRIVE_DOWNLOADS_DIR)"));
  const where = resolveSaveDir(downloads.dir, args.saveDir);
  if (!where.ok) return fail(inputError(where.reason));
  const id = fileIdFrom(args.fileId);
  const [raw, revisions] = await Promise.all([deps.drive.drive.get(id), deps.drive.drive.listRevisions(id)]);
  const file = shape(raw);
  const revision = revisions.find((r) => r.id === args.revisionId) ?? fail(notFoundError(`no revision ${args.revisionId} of "${file.name}" (list_revisions names them)`));
  const base = `${args.filename || file.name} (revision ${args.revisionId})`;
  if (file.isNative) {
    const plan = exportPlan(file.mimeType, args.format);
    if ("refused" in plan) return fail(inputError(`"${file.name}": ${plan.refused}`));
    const link = revision.exportLinks?.[plan.mime] ?? fail(inputError(`revision ${args.revisionId} of "${file.name}" offers ${formatsOf(file.mimeType, revision.exportLinks).join(", ") || "no export"}, not ${plan.format}`));
    const bytes = await deps.drive.drive.exportRevision(link);
    if (bytes.length > MAX_DOWNLOAD_BYTES) return fail(inputError(`the export is ${bytes.length} bytes, over ${MAX_DOWNLOAD_BYTES}`));
    const path = await downloads.save(where.dir, downloadName(base, plan.ext), bytes);
    return { fileId: id, revisionId: args.revisionId, name: file.name, path, size: bytes.length, sha256: hex("sha256", bytes), exportedAs: plan.format };
  }
  if (args.format) return fail(inputError(`"${file.name}" is a ${file.mimeType} with bytes of its own, saved as they were; format is for Google files`));
  const bytes = await deps.drive.drive.downloadRevision(id, args.revisionId);
  const md5 = hex("md5", bytes);
  if (revision.md5Checksum && revision.md5Checksum !== md5) {
    return fail(apiError(200, `the download is not what Drive stores for revision ${args.revisionId} (md5 ${md5}, Drive says ${revision.md5Checksum}); nothing was saved`));
  }
  const path = await downloads.save(where.dir, downloadName(revision.originalFilename || base), bytes);
  return { fileId: id, revisionId: args.revisionId, name: file.name, path, size: bytes.length, sha256: hex("sha256", bytes), md5, ...(revision.md5Checksum ? { verifiedBy: "md5" } : {}) };
};

/**
 * Keep a revision past Drive's pruning (files with bytes), or publish a
 * Google file's revision to the web: published, anyone can read it at
 * publishedLink, outside the domain too if publishedOutsideDomain.
 */
export const updateRevision = async (
  deps: Deps,
  args: { readonly fileId: string; readonly revisionId: string; readonly keepForever?: boolean; readonly published?: boolean; readonly publishAuto?: boolean; readonly publishedOutsideDomain?: boolean },
) => {
  const { keepForever, published, publishAuto, publishedOutsideDomain } = args;
  const patch = {
    ...(keepForever === undefined ? {} : { keepForever }),
    ...(published === undefined ? {} : { published }),
    ...(publishAuto === undefined ? {} : { publishAuto }),
    ...(publishedOutsideDomain === undefined ? {} : { publishedOutsideDomain }),
  };
  if (Object.keys(patch).length === 0) return fail(inputError("give keep_forever, published, publish_auto or published_outside_domain: nothing would change"));
  const id = fileIdFrom(args.fileId);
  const updated = await deps.drive.drive.updateRevision(id, args.revisionId, patch);
  return { fileId: id, ...revisionView(updated, []) };
};
