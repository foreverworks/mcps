import type { HttpAuth } from "@foreverworks/mcp-kit";

import type { Accounts, NotionPort } from "../app/ports.js";
import { configError, fail } from "../domain/errors.js";
import { makeNotionHttp, type NotionHttpOptions } from "./http.js";
import { makeNotionApi } from "./notionApi.js";
import { makeTokenFiles, TOKEN_PREFIX, tokensDirFrom } from "./tokens.js";

/**
 * The workspaces as the use cases see them: labels from the token files, and
 * one port per label, built on first use and kept, so a workspace's pacing is
 * shared by every session this process serves.
 */
export const makeAccounts = (env: NodeJS.ProcessEnv, options: NotionHttpOptions = {}): Accounts => {
  const source = tokensDirFrom(env);
  const files = makeTokenFiles(source);
  const ports = new Map<string, NotionPort>();

  const tokenOf = async (label: string, read: () => Promise<ReadonlyMap<string, string>>): Promise<string> =>
    (await read()).get(label) ?? fail(configError(`the token file ${TOKEN_PREFIX}${label} is gone from ${source ?? "the tokens directory"}`));

  const authFor = (label: string): HttpAuth => ({
    headers: async () => ({ Authorization: `Bearer ${await tokenOf(label, files.current)}` }),
    // After a 401: read the file again, so a token replaced on disk works on the retry the kit allows.
    renew: () => tokenOf(label, files.reload),
  });

  return {
    source,
    labels: async () => [...(await files.current()).keys()],
    api: (label) => {
      const known = ports.get(label);
      if (known !== undefined) return known;
      const port = makeNotionApi(makeNotionHttp(label, authFor(label), options));
      ports.set(label, port);
      return port;
    },
  };
};
