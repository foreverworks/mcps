import { resolveSaveDir, sha256Of } from "@foreverworks/mcp-kit";
import { basename } from "node:path";

import { fail, inputError } from "../../domain/errors.js";
import type { Deps } from "../ports.js";

export type SaveInput = {
  readonly messageId: string;
  readonly attachmentId: string;
  readonly saveDir?: string;
  readonly filename?: string;
};

/**
 * The capability Google's own Gmail MCP server does not have: it reports an
 * attachment's name and id and offers no way to fetch the bytes. The result
 * carries the saved file's size and sha256, so a copy made from it can be
 * checked against what was downloaded.
 */
export const saveAttachment = async (deps: Deps, input: SaveInput) => {
  const bytes = await deps.gmail.getAttachment(input.messageId, input.attachmentId);
  const where = resolveSaveDir(deps.paths.attachmentsDir, input.saveDir);
  if (!where.ok) return fail(inputError(where.reason));
  const dir = where.dir;
  // basename strips any path separators a caller sent, deliberately or not.
  const name = basename(input.filename || `${input.attachmentId.slice(0, 32)}.bin`);
  const path = await deps.files.writeFile(dir, name, bytes);
  return { messageId: input.messageId, attachmentId: input.attachmentId, path, bytes: bytes.length, sha256: sha256Of(bytes) };
};
