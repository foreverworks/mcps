import { join } from "node:path";

import { envPath } from "@foreverworks/mcp-kit";

import { buildGrant } from "../grants/grant.js";
import { type GrantRegistry, makeGrantRegistry } from "../grants/registry.js";
import { googleStateDir } from "../infra/locations.js";
import type { Deps } from "./app/ports.js";
import { makeTasksApi } from "./infra/tasksApi.js";

export type Registry = GrantRegistry<Deps>;

/**
 * Google Tasks, one grant per account under TASKS_ROOT
 * (`<root>/<label>/credentials.json`, written by consent, product tasks),
 * discovered on every lookup so a new consent needs no restart.
 */
export const buildRegistry = (env: NodeJS.ProcessEnv = process.env): Registry =>
  makeGrantRegistry("tasks", envPath(env, "TASKS_ROOT") ?? join(googleStateDir(env), "tasks"), (spec) => {
    const { grant, request } = buildGrant(spec, "Google Tasks");
    return { grant, tasks: makeTasksApi(request) };
  });
