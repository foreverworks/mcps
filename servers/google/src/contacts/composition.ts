import { join } from "node:path";

import { envPath } from "@foreverworks/mcp-kit";

import { buildGrant } from "../grants/grant.js";
import { type GrantRegistry, makeGrantRegistry } from "../grants/registry.js";
import { googleStateDir } from "../infra/locations.js";
import type { Deps } from "./app/ports.js";
import { makePeopleApi } from "./infra/peopleApi.js";

export type Registry = GrantRegistry<Deps>;

/**
 * Contacts and the directory (the People API), one grant per account under
 * CONTACTS_ROOT (`<root>/<label>/credentials.json`, written by consent,
 * product contacts), discovered on every lookup.
 */
export const buildRegistry = (env: NodeJS.ProcessEnv = process.env): Registry =>
  makeGrantRegistry("contacts", envPath(env, "CONTACTS_ROOT") ?? join(googleStateDir(env), "contacts"), (spec) => {
    const { grant, request } = buildGrant(spec, "Google People");
    return { grant, people: makePeopleApi(request) };
  });
