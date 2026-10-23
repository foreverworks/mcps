import { inputFilesFrom, once, type HttpOptions } from "@foreverworks/mcp-kit";

import type { Deps } from "./app/ports.js";
import { loadApiKey } from "./infra/credentials.js";
import { makeTypesafeHttp } from "./infra/http.js";
import { makeOutbox } from "./infra/outbox.js";
import { makeTypesafeApi } from "./infra/typesafeApi.js";

const API = "https://api.typesafe.ai";

/**
 * The composition root: the only module naming both a port and what
 * implements it. The key is read on the first call that needs it and kept;
 * a failed read is retried on the next call, so the server starts (and lists
 * its tools) without one.
 */
export const buildDeps = (env: NodeJS.ProcessEnv = process.env, options: HttpOptions & { readonly fetch?: typeof fetch } = {}): Deps => {
  const baseUrl = (env["TYPESAFE_BASE_URL"]?.trim() || API).replace(/\/+$/, "");
  return {
    systemOne: makeTypesafeApi(makeTypesafeHttp(once(() => loadApiKey(env)), options), baseUrl),
    outbox: makeOutbox(env),
    readInput: inputFilesFrom(env),
    defaultModel: env["TYPESAFE_MODEL"]?.trim() || "jev-latest",
    baseUrl,
    now: Date.now,
  };
};
