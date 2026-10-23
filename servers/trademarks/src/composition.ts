import { once } from "@foreverworks/mcp-kit";

import type { Deps, RecordsPort, RegisterPort } from "./app/ports.js";
import { makeEuipoRegister } from "./infra/euipo.js";
import { makeEuipoAuth } from "./infra/euipo/auth.js";
import { environmentOf, EUIPO_ENDPOINTS, loadEuipoCredentials, SOURCE as EUIPO } from "./infra/euipo/credentials.js";
import { makeRegisterHttp, type RegisterHttpOptions } from "./infra/http.js";
import { makeOutbox } from "./infra/outbox.js";
import { makeTsdrRecords, SOURCE as TSDR, TSDR_BASE } from "./infra/tsdr.js";
import { loadTsdrKey } from "./infra/tsdr/credentials.js";
import { makeUsptoRegister, SOURCE as USPTO, USPTO_BASE } from "./infra/uspto.js";

/** The sources this server knows; TRADEMARKS_SOURCES (comma-separated) narrows them, unset is all three. */
export const SOURCE_NAMES = ["uspto", "euipo", "tsdr"] as const;

const enabledSources = (env: NodeJS.ProcessEnv): ReadonlySet<string> => {
  const listed = env["TRADEMARKS_SOURCES"]?.trim();
  return new Set(listed ? listed.split(",").map((s) => s.trim().toLowerCase()) : SOURCE_NAMES);
};

/**
 * The composition root: the only module naming both a port and what
 * implements it. Credentials are read on the first call that needs them and
 * kept; a failed read is retried on the next call, so the server starts (and
 * lists its tools, and searches the US) without any.
 */
export const buildDeps = (env: NodeJS.ProcessEnv = process.env, options: RegisterHttpOptions = {}): Deps => {
  const enabled = enabledSources(env);
  const registers: RegisterPort[] = [];

  if (enabled.has("uspto")) {
    const http = makeRegisterHttp(
      {
        source: USPTO,
        service: "USPTO trademark search",
        // One a second: well under what its own page sends while a person types.
        gapMs: 1000,
        badRequest: "drift",
        refusedHint: "USPTO's search backend refused a plain request; it may now require its page's browser challenge, which this server does not answer",
      },
      options,
    );
    registers.push(makeUsptoRegister(http, env["TRADEMARKS_USPTO_URL"]?.trim() || USPTO_BASE));
  }

  if (enabled.has("euipo")) {
    const endpoints = EUIPO_ENDPOINTS[environmentOf(env)];
    const credentials = once(() => loadEuipoCredentials(env));
    const auth = makeEuipoAuth(credentials, endpoints.token, {
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
    });
    const http = makeRegisterHttp({ source: EUIPO, service: "EUIPO Trademark Search", gapMs: 250, badRequest: "input", auth }, options);
    registers.push(makeEuipoRegister(http, endpoints.api));
  }

  const records: RecordsPort[] = [];
  if (enabled.has("tsdr")) {
    const key = once(() => loadTsdrKey(env));
    const auth = { headers: async () => ({ "USPTO-API-KEY": await key() }) };
    const tsdr = { source: TSDR, service: "USPTO TSDR", badRequest: "input" as const, auth, authRefusal: "auth" as const };
    // 60 reads a minute per key, and 4 document bundles: paced under both. A bundle of an old file runs to megabytes.
    const http = makeRegisterHttp({ ...tsdr, gapMs: 1000 }, options);
    const documents = makeRegisterHttp({ ...tsdr, gapMs: 15_000 }, { timeoutMs: 120_000, ...options });
    records.push(makeTsdrRecords(http, documents, env["TRADEMARKS_TSDR_URL"]?.trim() || TSDR_BASE));
  }

  return { registers, records, outbox: makeOutbox(env), now: Date.now };
};
