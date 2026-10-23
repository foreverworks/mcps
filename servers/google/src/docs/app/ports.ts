/**
 * What the Docs use cases need, named as operations. No URL appears above infra/.
 */
import type { Deps as DriveDeps } from "../../drive/app/ports.js";
import type { ApiRequest } from "../../editors/domain/discovery.js";
import type { DocsRequest, RawBatchUpdateResponse, RawDocument } from "../domain/schema.js";

/** How much of a document a read asks for. */
export type GetOptions = {
  /** Every tab's content under `tabs`; without it, the first tab's at the top level. */
  readonly tabs?: boolean;
  /** How suggested edits are shown (Docs' suggestionsViewMode); Docs' default for the caller's access when absent. */
  readonly suggestions?: string;
  /** A partial response: Google's field mask over the Document. */
  readonly fields?: string;
};

/** What a batch is pinned to (Docs' writeControl): refused unless the document is still at a revision, or applied as of one. */
export type WriteControl = { readonly requiredRevisionId?: string; readonly targetRevisionId?: string };

export type DocsPort = {
  readonly get: (documentId: string, options?: GetOptions) => Promise<RawDocument>;
  /**
   * One batchUpdate, applied only while the document is still at `revisionId`
   * (writeControl.requiredRevisionId). Answers the revision it produced, when
   * Docs says.
   */
  readonly batchUpdate: (documentId: string, requests: readonly DocsRequest[], revisionId: string) => Promise<string | null>;
  /** Any requests the API takes, checked against its schema by the caller, and the whole answer: every reply and the new revision. */
  readonly apply: (documentId: string, requests: readonly ApiRequest[], control: WriteControl) => Promise<RawBatchUpdateResponse>;
};

export type Deps = {
  readonly account: string;
  readonly docs: DocsPort;
  /** The Drive product's own port and use cases, under the same grant: a new document goes into its folder through them. */
  readonly drive: DriveDeps;
};
