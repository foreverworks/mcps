import { createHash } from "node:crypto";
import { basename } from "node:path";

import type { FileSource } from "@foreverworks/mcp-kit";

import { mimeTypeFor } from "../../../domain/mimeTypes.js";
import { FOLDER_MIME, isNative, shape } from "../../domain/entries.js";
import { ambiguousError, apiError, describeThrown, fail, inputError, required } from "../../domain/errors.js";
import type { RawFile } from "../../domain/schema.js";
import { conversionOf, convertedName, type IfExists, mirroredFolder, storedCheck } from "../../domain/upload.js";
import type { Deps } from "../ports.js";
import { targetId } from "./browse.js";

export type UploadArgs = {
  readonly source: FileSource;
  /** The folder: by id, else by path, else the one a mirror file stands for, else the root. */
  readonly folderId: string;
  readonly folderPath: string;
  /** Defaults to the source's name. */
  readonly name: string;
  /** Defaults to a guess from the name. */
  readonly mimeType: string;
  readonly ifExists: IfExists;
  /** Upload an Office file as the Google file it converts to. */
  readonly convert?: boolean;
};

/**
 * A file onto Drive, byte for byte, and proved so.
 *
 * The bytes come from mcp-kit's reader (a path in the file roots, or base64
 * checked against the source's sha256), never from text a model typed. After
 * the upload Drive's own checksum of what it stored is compared with the
 * source: a difference fails the call loudly, naming the stored file, because
 * a damaged copy that reports success is the failure nobody notices.
 *
 * A file read from the Drive mirror goes, unless told otherwise, to the folder
 * it mirrors, so publishing work done in the mirror is one call instead of a
 * wait for the next sync. A file read by path keeps its modification time on
 * Drive: the mirror's sync then finds the same size and time on both sides and
 * has nothing to do.
 */
/**
 * Drive's checksum of what it stored, against the source's. Drive reports one
 * for every file with bytes; when it reports none, the stored bytes are read
 * back and hashed here, so a result never says "unverified" about a file this
 * server could have checked.
 */
type Verified = { readonly verifiedBy: "sha256" | "md5" | "download" } | { readonly mismatch: string };

const verified = async (deps: Deps, stored: RawFile, source: { readonly sha256: string; readonly md5: string }): Promise<Verified> => {
  const check = storedCheck(stored, source);
  if (!("unverified" in check)) return check;
  const back = createHash("sha256").update(await deps.drive.download(required(stored.id, "file id"))).digest("hex");
  return back === source.sha256 ? { verifiedBy: "download" } : { mismatch: `the stored bytes read back hash to ${back}, the source is ${source.sha256}` };
};

/**
 * A damaged upload, taken back so it is not what the name now holds: a
 * replacement's new revision is deleted (the file is back to the content it
 * had), a new file is trashed (recoverable for 30 days, for inspection). The
 * sentence says which, or why it could not be done.
 */
const takeBack = async (deps: Deps, stored: RawFile, replaced: boolean): Promise<string> => {
  const id = stored.id ?? "unknown";
  try {
    if (replaced) {
      await deps.drive.deleteRevision(id, required(stored.headRevisionId, "head revision id"));
      return `the damaged revision was deleted, so ${id} holds its previous content again`;
    }
    await deps.drive.update(id, { trashed: true });
    return `the damaged file ${id} was moved to the trash`;
  } catch (thrown) {
    return `taking it back failed (${describeThrown(thrown)}): ${id} holds the damaged bytes now`;
  }
};

/**
 * An Office file uploaded as the Google file it converts to. A converted file
 * keeps no bytes to compare with the source, so what is checked is what can
 * be: that Drive made the Google type asked for. A file it stored as anything
 * else is trashed and the call fails. The source's size and sha256 are
 * reported as the source's, never as the stored file's.
 */
const uploadConverted = async (deps: Deps, args: UploadArgs, file: Awaited<ReturnType<Deps["readInput"]>>, sourceMime: string, mirrored: string | undefined) => {
  const convertTo =
    conversionOf(sourceMime) ??
    fail(inputError(`a ${sourceMime} file does not convert to a Google file; convert takes .docx, .doc, .xlsx, .xls, .csv, .pptx or .ppt`));
  if (args.ifExists === "replace") {
    return fail(inputError('a converted upload makes a new Google file; if_exists "replace" is for files with bytes, so give a new filename or "keep_both"'));
  }
  const name = convertedName((args.name || file.name).trim());
  if (name === "") return fail(inputError("give filename: content_base64 carries no file name"));
  if (name.includes("/")) return fail(inputError(`"${name}" contains a slash; Drive names have none, a folder is folder_path`));
  const chosen = args.folderId !== "" || args.folderPath.trim() !== "";
  const parentId = await targetId(deps, args.folderId, chosen ? args.folderPath : (mirrored ?? ""));
  const taken = await deps.drive.childrenNamed(parentId, name);
  if (taken.length > 0 && args.ifExists === "fail") {
    return fail(inputError(`"${name}" already exists there (${taken.map((t) => t.id).join(", ")}): give another filename, or if_exists "keep_both" adds a second file of that name`));
  }
  const stored = await deps.drive.upload(parentId, { name, mimeType: sourceMime, bytes: file.bytes, convertTo });
  if (stored.mimeType !== convertTo) {
    const undone = await takeBack(deps, stored, false);
    return fail(apiError(200, `Drive stored the upload as ${stored.mimeType ?? "an unknown type"}, not the ${convertTo} asked for; ${undone}`));
  }
  return {
    ...shape(stored),
    converted: { from: sourceMime, to: convertTo },
    source: { size: file.size, sha256: file.sha256 },
    ...(mirrored === undefined ? {} : { mirroredFolder: mirrored }),
  };
};

export const uploadFile = async (deps: Deps, args: UploadArgs) => {
  const file = await deps.readInput(args.source);
  const mirroredFrom = deps.mirror === undefined || file.path === undefined ? undefined : mirroredFolder(deps.mirror, file.path);
  // The type comes from the source's own name: a filename given for Drive (often without an extension) says nothing about the bytes.
  if (args.convert) return uploadConverted(deps, args, file, args.mimeType || mimeTypeFor(file.path === undefined ? file.name : basename(file.path)), mirroredFrom);
  const name = (args.name || file.name).trim();
  if (name === "") return fail(inputError("give filename: content_base64 carries no file name"));
  if (name.includes("/")) return fail(inputError(`"${name}" contains a slash; Drive names have none, a folder is folder_path`));

  const mirrored = mirroredFrom;
  const chosen = args.folderId !== "" || args.folderPath.trim() !== "";
  const parentId = await targetId(deps, args.folderId, chosen ? args.folderPath : (mirrored ?? ""));
  const taken = await deps.drive.childrenNamed(parentId, name);
  if (taken.length > 0 && args.ifExists === "fail") {
    return fail(
      inputError(
        `"${name}" already exists there (${taken.map((t) => t.id).join(", ")}): if_exists "replace" gives it these bytes as a new revision (same id, the old one kept), "keep_both" adds a second file of that name`,
      ),
    );
  }
  if (args.ifExists === "replace" && taken.length > 1) {
    return fail(ambiguousError(`${taken.length} files are named "${name}" there; replace needs one`, taken.map((t) => `${t.id} (${t.mimeType})`)));
  }
  const target = args.ifExists === "replace" ? taken[0] : undefined;
  if (target !== undefined && (target.mimeType === FOLDER_MIME || isNative(target.mimeType ?? ""))) {
    return fail(inputError(`"${name}" there is a ${target.mimeType}; only a file with bytes can take new content`));
  }

  const upload = {
    name,
    mimeType: args.mimeType || mimeTypeFor(name),
    bytes: file.bytes,
    ...(file.modified === undefined ? {} : { modifiedTime: file.modified.toISOString() }),
  };
  const stored =
    target === undefined ? await deps.drive.upload(parentId, upload) : await deps.drive.replaceContent(required(target.id, "file id"), upload);
  const md5 = createHash("md5").update(file.bytes).digest("hex");
  const check = await verified(deps, stored, { sha256: file.sha256, md5 });
  if ("mismatch" in check) {
    const undone = await takeBack(deps, stored, target !== undefined);
    return fail(apiError(200, `the upload reached Drive changed: ${check.mismatch}; ${undone}`));
  }
  return {
    ...shape(stored),
    replaced: target !== undefined,
    size: file.size,
    sha256: file.sha256,
    md5,
    verifiedBy: check.verifiedBy,
    // The folder the source stands for in the mirror ("" is the root), whether or not it went there.
    ...(mirrored === undefined ? {} : { mirroredFolder: mirrored }),
  };
};
