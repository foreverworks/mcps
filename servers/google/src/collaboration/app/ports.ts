/**
 * What the collaboration use cases need: the Drive product's own port and use
 * cases, under the account's grant. Comments, sharing and revisions are Drive
 * API resources on any file, a Doc, a Sheet, a deck or a PDF alike.
 */
import type { Deps as DriveDeps } from "../../drive/app/ports.js";

export type Deps = {
  readonly account: string;
  readonly drive: DriveDeps;
};
