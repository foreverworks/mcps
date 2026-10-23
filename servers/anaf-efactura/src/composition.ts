import { epochNow, type HttpOptions, inputFilesFrom, once, type OAuthClient } from "@foreverworks/mcp-kit";

import type { AppIdentity, Clock, Deps } from "./app/ports.js";
import { makeAnafApi } from "./infra/anafApi.js";
import { makeAuthorization } from "./infra/authorization.js";
import { configError, fail } from "./domain/errors.js";
import { type AppConfig, loadConfig } from "./infra/config.js";
import { makeFiles, withOutbox } from "./infra/files.js";
import { makeGrant } from "./infra/grant.js";
import { makePublicRequest, makeRequest } from "./infra/http.js";
import { anafOAuthClient } from "./infra/oauthClient.js";
import { resolvePaths } from "./infra/paths.js";
import { makeSealCheck } from "./infra/seal.js";
import { makeUploadLedger } from "./infra/uploadLedger.js";
import { SEAL_ORGANIZATION_IDENTIFIER, sealAnchors } from "./infra/sealTrust.js";
import { readDeclarationXml, readInvoiceXml, viewInvoiceXml } from "./infra/xml.js";
import { readZip } from "./infra/zip.js";

export type BuildOptions = {
  readonly http?: HttpOptions;
  /** Seconds since the epoch; a test hands in its own. */
  readonly now?: Clock;
};

/**
 * The composition root: the ONLY place that names both an interface and the
 * thing implementing it. Every other module depends on ports, which is what
 * lets the tests swap the network out without touching a line of production
 * code.
 *
 * Paths come from `env` alone (infra/paths.ts), and nothing is read here:
 * app.json is read on first use, so a missing or broken one, or a layout that
 * would write beside it, is the tool that needs it answering "config", never a
 * server that did not start.
 */
export const buildDeps = (env: NodeJS.ProcessEnv, { http = {}, now = epochNow }: BuildOptions = {}): Deps => {
  const paths = resolvePaths(env);
  const layout = (): void => {
    if (paths.layoutProblem !== undefined) fail(configError(paths.layoutProblem));
  };
  const config: () => Promise<AppConfig> = once(async () => {
    layout();
    return loadConfig(paths.config);
  });
  const client = async (): Promise<OAuthClient> => anafOAuthClient(await config(), http);

  const grant = makeGrant({ tokensPath: paths.tokens, stateDir: paths.stateDir, client, now });
  const anaf = makeAnafApi(async () => (await config()).endpoints, makeRequest(grant.access, http), makePublicRequest(http));

  const identity = async (): Promise<AppIdentity> => {
    const c = await config();
    return { appName: c.appName, clientIdLast4: c.clientId.slice(-4), defaultCif: c.cif };
  };

  return {
    anaf,
    tokens: grant.tokens,
    authorization: makeAuthorization({ config, client, stateDir: paths.stateDir }),
    files: makeFiles(withOutbox(inputFilesFrom(env), paths.downloadsDir), layout),
    uploads: makeUploadLedger(paths.stateDir),
    paths,
    identity,
    readInvoice: readInvoiceXml,
    viewInvoice: viewInvoiceXml,
    readDeclaration: readDeclarationXml,
    unzip: readZip,
    checkSeal: makeSealCheck({ anchors: sealAnchors(), organizationIdentifier: SEAL_ORGANIZATION_IDENTIFIER }),
    now,
  };
};
