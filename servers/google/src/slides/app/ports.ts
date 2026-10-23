/**
 * What the Slides use cases need, named as operations. No URL appears above infra/.
 */
import type { Deps as DriveDeps } from "../../drive/app/ports.js";
import type { ApiRequest } from "../../editors/domain/discovery.js";
import type { RawBatchUpdateResponse, RawPresentation, RawThumbnail, SlidesRequest } from "../domain/schema.js";

export type ThumbnailSize = "SMALL" | "MEDIUM" | "LARGE";

export type SlidesPort = {
  /** The whole deck, or a field mask's worth of it. */
  readonly get: (presentationId: string, fields?: string) => Promise<RawPresentation>;
  /** One batch, applied only while the deck is still at `revisionId` (writeControl.requiredRevisionId) when one is given. */
  readonly batchUpdate: (presentationId: string, requests: readonly SlidesRequest[], revisionId?: string) => Promise<RawBatchUpdateResponse>;
  /** Any requests the API takes, checked against its schema by the caller; pinned to `revisionId` when one is given. */
  readonly apply: (presentationId: string, requests: readonly ApiRequest[], revisionId?: string) => Promise<RawBatchUpdateResponse>;
  /** A rendered PNG of one slide, as a short-lived URL. */
  readonly thumbnail: (presentationId: string, pageId: string, size: ThumbnailSize) => Promise<RawThumbnail>;
};

export type Deps = {
  readonly account: string;
  readonly slides: SlidesPort;
  /** The Drive product's own port and use cases, under the same grant: a deck is a Drive copy of its template. */
  readonly drive: DriveDeps;
  /** A fresh prefix for the object ids one outline's slides get. */
  readonly nonce: () => string;
};
