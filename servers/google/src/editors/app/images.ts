import { randomBytes } from "node:crypto";

import type { FileSource } from "@foreverworks/mcp-kit";

import type { Deps as DriveDeps } from "../../drive/app/ports.js";
import type { ApiRequest } from "../domain/discovery.js";
import { asAppError, fail, inputError } from "../domain/errors.js";
import { imageKind, IMAGE_MAX_BYTES, imageReferences, substituteImages } from "../domain/images.js";

/**
 * Local images into a Doc or a deck. Docs and Slides insert an image only from
 * a URL they fetch themselves, once, at insertion, keeping their own copy
 * (developers.google.com/workspace/docs/api/how-tos/images). So each image is
 * uploaded to the account's Drive, readable by anyone with its link for as long
 * as the batch takes, and then unshared and trashed whatever happened: the
 * document keeps its copy. The link is a Drive file id nobody else has seen.
 */

export type StagedImage = {
  readonly name: string;
  readonly sha256: string;
  readonly size: number;
  readonly mimeType: string;
  /** What became of the Drive copy: "removed", or why it was not and where it is. */
  readonly staged: string;
};

/** The URL Docs and Slides fetch a staged image from: Drive's download link for a file shared by link. */
export const stagedUrl = (fileId: string): string => `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;

export const withStagedImages = async <T>(
  drive: DriveDeps,
  images: Readonly<Record<string, FileSource>>,
  requests: readonly ApiRequest[],
  run: (requests: readonly ApiRequest[]) => Promise<T>,
): Promise<{ readonly result: T; readonly images: readonly StagedImage[] }> => {
  const referenced = imageReferences(requests);
  const defined = Object.keys(images);
  const undefinedNames = [...referenced].filter((n) => !defined.includes(n));
  if (undefinedNames.length > 0) return fail(inputError(`the requests use ${undefinedNames.map((n) => `image:${n}`).join(", ")}, which images does not define`));
  const unused = defined.filter((n) => !referenced.has(n));
  if (unused.length > 0) return fail(inputError(`images defines ${unused.join(", ")}, which no request uses as "image:<name>"`));
  if (defined.length === 0) return { result: await run(requests), images: [] };

  const files = await Promise.all(
    defined.map(async (name) => {
      const file = await drive.readInput(images[name] as FileSource);
      const mimeType = imageKind(file.bytes) ?? fail(inputError(`image ${name} is not a PNG, JPEG or GIF, the formats Docs and Slides take`));
      if (file.size > IMAGE_MAX_BYTES) return fail(inputError(`image ${name} is ${file.size} bytes, over the ${IMAGE_MAX_BYTES} Docs and Slides take`));
      return { name, file, mimeType };
    }),
  );

  const nonce = randomBytes(6).toString("hex");
  const staged: { name: string; fileId: string; permissionId?: string }[] = [];
  try {
    for (const { name, file, mimeType } of files) {
      const uploaded = await drive.drive.upload("root", { name: `mcp-staged-image-${nonce}-${name}`, mimeType, bytes: file.bytes });
      const entry: { name: string; fileId: string; permissionId?: string } = { name, fileId: uploaded.id ?? "" };
      staged.push(entry);
      const permission = await drive.drive.createPermission(entry.fileId, { type: "anyone", role: "reader", allowFileDiscovery: false }, { notify: false });
      entry.permissionId = permission.id ?? "anyoneWithLink";
    }
    const urls = Object.fromEntries(staged.map((s) => [s.name, stagedUrl(s.fileId)]));
    const result = await run(substituteImages(requests, urls));
    return { result, images: await cleanUp(drive, staged, files) };
  } catch (thrown) {
    const report = await cleanUp(drive, staged, files);
    const error = asAppError(thrown);
    const leftover = report.filter((r) => r.staged !== "removed");
    if (error && leftover.length > 0) return fail({ ...error, message: `${error.message}; staged images not removed: ${leftover.map((r) => `${r.name} (${r.staged})`).join("; ")}` });
    throw thrown;
  }
};

const cleanUp = async (
  drive: DriveDeps,
  staged: readonly { readonly name: string; readonly fileId: string; readonly permissionId?: string }[],
  files: readonly { readonly name: string; readonly file: { readonly sha256: string; readonly size: number }; readonly mimeType: string }[],
): Promise<readonly StagedImage[]> =>
  Promise.all(
    files.map(async ({ name, file, mimeType }) => {
      const entry = staged.find((s) => s.name === name);
      const base = { name, sha256: file.sha256, size: file.size, mimeType };
      if (!entry) return { ...base, staged: "never uploaded" };
      const problems: string[] = [];
      if (entry.permissionId) {
        await drive.drive.deletePermission(entry.fileId, entry.permissionId).catch((e: unknown) => problems.push(`still shared by link (${asAppError(e)?.message ?? String(e)})`));
      }
      await drive.drive.update(entry.fileId, { trashed: true }).catch((e: unknown) => problems.push(`not trashed (${asAppError(e)?.message ?? String(e)})`));
      return { ...base, staged: problems.length === 0 ? "removed" : `Drive file ${entry.fileId}: ${problems.join("; ")}` };
    }),
  );
