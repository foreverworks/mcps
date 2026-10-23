import { envPath, inputFilesFrom, once } from "@foreverworks/mcp-kit";

import type { Deps } from "./app/ports.js";
import { loadKeyPair } from "./infra/credentials.js";
import { DEPLOY_MAX_BYTES } from "./app/deploySite.js";
import { OUTBOX_VARIABLE } from "./domain/errors.js";
import { makePorkbunPort } from "./infra/porkbunPort.js";
import { vendorConfig } from "./infra/vendor.js";

/**
 * The composition root: the only module naming both the port and what
 * implements it. The key pair is read on the first call that needs it (so
 * `tools/list` works without one, as in the vendor's server) and kept for the
 * life of the process; a failed read is retried on the next call. The files
 * deploy_site uploads (and import_dns_records' records file) come through the
 * kit's reader, from MCP_FILE_ROOTS. get_ssl_bundle and get_invoice_pdf save
 * into PORKBUN_OUTBOX_DIR, which has no default: a private key goes where the
 * deployment chose, or nowhere.
 */
export const buildDeps = (env: NodeJS.ProcessEnv = process.env): Deps => ({
  porkbun: makePorkbunPort(once(async () => vendorConfig(await loadKeyPair(env)))),
  files: inputFilesFrom(env, { maxBytes: DEPLOY_MAX_BYTES }),
  outbox: envPath(env, OUTBOX_VARIABLE),
});
