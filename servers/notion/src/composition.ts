import { envPath, inputFilesFrom, memoize } from "@foreverworks/mcp-kit";

import { makeLocator } from "./app/locate.js";
import type { Deps } from "./app/ports.js";
import { readAllUsers } from "./app/usecases/users.js";
import { MAX_UPLOAD_BYTES } from "./domain/files.js";
import { makeAccounts } from "./infra/accounts.js";
import { makeDownload } from "./infra/download.js";
import type { NotionHttpOptions } from "./infra/http.js";

/** How long a data source's columns are trusted: a column just added shows up within this. */
export const SCHEMA_TTL_MS = 60_000;

/** How long a workspace's user list is trusted: people join rarely, and a filter by name reads it on every call. */
export const USERS_TTL_MS = 5 * 60_000;

/**
 * The composition root: the ONLY place that names both a port and the thing
 * implementing it, which is what lets the tests swap the network out without
 * touching a line of production code.
 *
 * Built once per process. Under a service that one process serves every
 * session, so the pacing, the schema cache and what the locator has learned
 * are shared by all of them. Nothing here touches the network or a file: the
 * token files are read on the first call that needs them, and a missing one
 * is that call's failure.
 */
export const buildDeps = (env: NodeJS.ProcessEnv = process.env, options: NotionHttpOptions = {}): Deps => {
  const accounts = makeAccounts(env, options);
  const schema = memoize(SCHEMA_TTL_MS, (key: string) => {
    const [account = "", id = ""] = key.split("\n");
    return accounts.api(account).getDataSource(id);
  });
  const users = memoize(USERS_TTL_MS, (account: string) => readAllUsers(accounts.api(account)));
  return {
    accounts,
    locator: makeLocator(accounts),
    schema: (account, id) => schema(`${account}\n${id}`),
    users,
    readInput: inputFilesFrom(env, { maxBytes: MAX_UPLOAD_BYTES }),
    outbox: envPath(env, "NOTION_OUTBOX_DIR"),
    download: makeDownload(),
  };
};
