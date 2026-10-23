import { type Editors, type ProductRegistry, productRegistry } from "../editors/composition.js";
import type { Deps } from "./app/ports.js";
import { makeSheetsApi } from "./infra/sheetsApi.js";

export type Registry = ProductRegistry<Deps>;

/**
 * The composition root: the ONLY module that names both a port and its
 * implementation. The grant, its token cache and the Drive deps are the
 * shared registry's (src/editors), so Sheets builds only its own adapter.
 */
export const buildRegistry = (editors: Editors): Registry =>
  productRegistry(editors, (account) => ({ account: account.label, sheets: makeSheetsApi(account.request("sheets")), drive: account.drive }));
