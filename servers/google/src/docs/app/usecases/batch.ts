import type { FileSource } from "@foreverworks/mcp-kit";

import { withStagedImages } from "../../../editors/app/images.js";
import { checked, repliesOf, staleRevision } from "../../../editors/domain/batch.js";
import { fileIdFrom } from "../../../editors/domain/ids.js";
import { DOCS_API } from "../../domain/api.js";
import { pinFor } from "../../domain/batch.js";
import { asAppError, fail } from "../../domain/errors.js";
import { docLink } from "../../domain/fromDocs.js";
import type { Deps } from "../ports.js";

export type BatchArgs = {
  readonly documentId: string;
  readonly requests: readonly unknown[];
  readonly expectedRevision: string;
  readonly targetRevision: string;
  /** Local images the requests name as "image:<name>". */
  readonly images: Readonly<Record<string, FileSource>>;
};

/**
 * Any requests the Docs API takes, as one batchUpdate: all apply or none do.
 * Checked against the API's schema first (nothing is sent if one is wrong),
 * and pinned to a revision whenever one names an index (domain/batch.ts).
 */
export const batchUpdateDocument = async (deps: Deps, args: BatchArgs) => {
  const requests = checked(DOCS_API, args.requests);
  const pin = pinFor(requests, args.expectedRevision.trim(), args.targetRevision.trim());
  const id = fileIdFrom(args.documentId);
  try {
    const { result: answer, images } = await withStagedImages(deps.drive, args.images, requests, (ready) => deps.docs.apply(id, ready, pin));
    return {
      documentId: answer.documentId ?? id,
      link: docLink(answer.documentId ?? id),
      /** For the next batch's expected_revision. */
      revisionId: answer.writeControl?.requiredRevisionId ?? null,
      applied: requests.length,
      replies: repliesOf(answer.replies),
      ...(images.length > 0 ? { images } : {}),
    };
  } catch (thrown) {
    const stale = staleRevision(asAppError(thrown), !!pin.requiredRevisionId);
    if (stale) return fail(stale);
    throw thrown;
  }
};
