import { z } from "zod";

import { ALL_ACCOUNTS } from "../../domain/accounts.js";
import type { FileSource } from "@foreverworks/mcp-kit";

import { type Discovery, requestKinds } from "../domain/discovery.js";
import { IMAGE_NAME } from "../domain/images.js";

/**
 * The account argument every Docs, Sheets and Slides tool takes, worded once.
 * Labels are the ones Gmail and Calendar use for the same identities.
 */
export const readAccountArg = () =>
  z
    .string()
    .default("")
    .describe("Which account: a label from list_accounts (its editors section). Empty means the default account.");

/**
 * A write never falls back to a default account: a document created or edited
 * as the wrong identity is shared, owned and attributed as that identity.
 */
export const writeAccountArg = () =>
  z
    .string()
    .min(1)
    .refine((v) => v.trim() !== ALL_ACCOUNTS, `a write takes one account, not "${ALL_ACCOUNTS}"`)
    .describe("Which account this writes as: a label from list_accounts (its editors section). Required; writes have no default.");

/** Where a new file goes, the way Drive's own tools name a folder: an id, or a path. Both empty means My Drive's root. */
export const folderArgs = () => ({
  folder_id: z.string().default("").describe("Drive folder id to create it in. Takes precedence over folder_path."),
  folder_path: z.string().default("").describe('Folder path under My Drive, e.g. "Clients/Acme". Both empty means the root.'),
});

/** A file by id or by the URL it opens at. */
export const fileIdArg = (what: string) => z.string().min(1).describe(`The ${what}'s id, or its URL.`);

/**
 * A batch's requests, one kind each, as the API spells them. The schema here is
 * loose on purpose: the use case checks each against the API's own Discovery
 * schema and answers every problem at once with the nearest right name, which a
 * generic validation error could not.
 */
export const requestsArg = (api: Discovery, example: string) =>
  z
    .array(z.record(z.string(), z.unknown()))
    .min(1)
    .max(1000)
    .describe(
      `${api.name} batchUpdate requests, applied in order, all or none: each an object with ONE request kind, e.g. ${example}. ` +
        `Kinds: ${Object.keys(requestKinds(api)).join(", ")}. editors_api_reference names each kind's fields.`,
    );

export type ImageArgs = Record<string, { path?: string | undefined; content_base64?: string | undefined; sha256?: string | undefined }>;

/**
 * Local images a batch inserts, by name: a request says "image:<name>" where
 * the API wants an image URL, and the file is staged on Drive for Google to
 * fetch (editors/app/images.ts).
 */
export const imagesArg = () =>
  z
    .record(
      z.string().regex(IMAGE_NAME),
      z.strictObject({
        path: z.string().optional().describe("The image file, in the server's file roots (where upload_file reads)."),
        content_base64: z.string().optional().describe("Instead of path, from a script only: never typed. Needs sha256."),
        sha256: z.string().optional().describe("Hex SHA-256 of the source: required with content_base64, checked with path."),
      }),
    )
    .default({})
    .describe(
      'Local PNG, JPEG or GIF images by name; use "image:<name>" as the image URL in a request (insertInlineImage.uri, createImage.url, ' +
        "replaceImage, replaceAllShapesWithImage.imageUrl). Each is uploaded to Drive, shared by link only while the batch runs, then unshared and trashed.",
    );

export const imageSources = (images: ImageArgs): Readonly<Record<string, FileSource>> =>
  Object.fromEntries(
    Object.entries(images).map(([name, i]) => [name, { path: i.path, contentBase64: i.content_base64, sha256: i.sha256, name }]),
  );
