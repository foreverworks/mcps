import { randomBytes } from "node:crypto";

import { type Editors, type ProductRegistry, productRegistry } from "../editors/composition.js";
import type { Deps } from "./app/ports.js";
import { makeSlidesApi } from "./infra/slidesApi.js";

export type Registry = ProductRegistry<Deps>;

/** A letter first (Slides wants an id to start with one), then enough randomness that two outlines never collide. */
const nonce = (): string => `o${randomBytes(6).toString("hex")}`;

/**
 * The composition root: the ONLY module that names both a port and its
 * implementation. The grant, its token cache and the Drive deps are the
 * shared registry's (src/editors), so Slides builds only its own adapter.
 */
export const buildRegistry = (editors: Editors): Registry =>
  productRegistry(editors, (account) => ({ account: account.label, slides: makeSlidesApi(account.request("slides")), drive: account.drive, nonce }));
