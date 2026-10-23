import { exportMimeFor, isNative, shape, type Entry } from "../../domain/entries.js";
import { fail, inputError } from "../../domain/errors.js";
import type { Deps } from "../ports.js";
import { targetId } from "./browse.js";
import { required } from "../../domain/errors.js";

export type DocText = {
  readonly entry: Entry;
  readonly format: string;
  readonly exportedAs: string;
  readonly truncated: boolean;
  readonly text: string;
};

/**
 * Read a Google Doc, Sheet or Slide deck as text.
 *
 * A Doc has no bytes to download, so a local copy of a Drive holds at best a
 * placeholder or a stale export of it. Exporting on demand costs one request
 * and returns the thing a caller actually wanted, the words.
 *
 * A binary file is refused rather than guessed at: download_file saves its
 * bytes, and returning a PDF as a string would be a worse answer than that.
 */
export const readDoc = async (
  deps: Deps,
  args: { readonly fileId: string; readonly path: string; readonly format: string; readonly maxChars: number },
): Promise<DocText> => {
  const id = await targetId(deps, args.fileId, args.path);
  const raw = await deps.drive.get(id);

  const mimeType = required(raw.mimeType, "file mimeType");
  if (!isNative(mimeType)) {
    return fail(
      inputError(
        `${raw.name} is ${raw.mimeType}, which has real bytes; download_file saves them`,
      ),
    );
  }
  const exportMime = exportMimeFor(mimeType, args.format);
  if (exportMime === null) {
    return fail(inputError(`${raw.mimeType} cannot be exported as ${args.format}`));
  }

  const full = await deps.drive.exportText(id, exportMime);
  const truncated = full.length > args.maxChars;
  return {
    entry: shape(raw),
    format: args.format,
    exportedAs: exportMime,
    truncated,
    text: truncated ? full.slice(0, args.maxChars) : full,
  };
};
