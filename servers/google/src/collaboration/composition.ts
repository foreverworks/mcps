import { type Editors, type ProductRegistry, productRegistry } from "../editors/composition.js";
import type { Deps } from "./app/ports.js";

export type Registry = ProductRegistry<Deps>;

/**
 * The composition root. Comments, sharing and revisions act as an editors
 * account (the one GOOGLE_EDITORS_DRIVE_ACCOUNT names on the Drive grant,
 * others on their own), so they are that
 * account's Drive deps and nothing of their own.
 */
export const buildRegistry = (editors: Editors): Registry => productRegistry(editors, (account) => ({ account: account.label, drive: account.drive }));
