import { inputFilesFrom, memoize, once } from "@foreverworks/mcp-kit";

import type { Deps } from "./app/ports.js";
import { loadVisible } from "./app/usecases/projects.js";
import { loadToken } from "./infra/credentials.js";
import { makeEasApi } from "./infra/easApi.js";
import { API, makeGraphql } from "./infra/graphql.js";
import { type EasHttpOptions, makeEasHttp } from "./infra/http.js";
import { makeLogs } from "./infra/logs.js";
import { readWorkflow } from "./infra/workflowYaml.js";

/** A workflow file is a few kilobytes; anything near this is not one. */
export const WORKFLOW_MAX_BYTES = 1024 * 1024;

/** How long the list of visible projects is trusted: a project added to the account shows up within this. */
export const VISIBLE_TTL_MS = 5 * 60_000;

const list = (value: string | undefined, fallback: readonly string[]): readonly string[] => {
  const items = (value ?? "").split(",").map((s) => s.trim()).filter((s) => s !== "");
  return items.length === 0 ? fallback : items;
};

/**
 * The composition root: the only module naming both a port and what
 * implements it. Built once per process; under a service that one process
 * serves every session, so the visible-projects cache is shared. Nothing here
 * reads the token or touches the network: the first call that needs the token
 * reads it, and a missing one is that call's failure, so the server starts
 * and lists its tools without one.
 *
 * Settings, from the environment only: EXPO_TOKEN_FILE or EXPO_TOKEN (the
 * token), EAS_PROJECT (the project a call means when it names none),
 * EAS_PRODUCTION_CHANNELS (comma-separated, default `production`), EXPO_API_URL;
 * MCP_FILE_ROOTS, where a workflow file given by path may lie (docs/configuration.md).
 */
export const buildDeps = (env: NodeJS.ProcessEnv = process.env, options: EasHttpOptions = {}): Deps => {
  let token = once(() => loadToken(env));
  const auth = {
    headers: async () => ({ authorization: `Bearer ${await token()}` }),
    // After a 401: read the file again, so a replaced token works on the retry the kit allows.
    renew: async () => {
      token = once(() => loadToken(env));
      return token();
    },
  };
  const eas = makeEasApi(makeGraphql(makeEasHttp(auth, options), env["EXPO_API_URL"]?.trim() || API));
  const visible = memoize(VISIBLE_TTL_MS, () => loadVisible(eas));
  const defaultProject = env["EAS_PROJECT"]?.trim();
  return {
    eas,
    visible: () => visible(""),
    logs: makeLogs(makeEasHttp(undefined, options)),
    readWorkflow,
    files: inputFilesFrom(env, { maxBytes: WORKFLOW_MAX_BYTES }),
    now: Date.now,
    sleep: options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms))),
    ...(defaultProject ? { defaultProject } : {}),
    productionChannels: list(env["EAS_PRODUCTION_CHANNELS"], ["production"]),
  };
};
