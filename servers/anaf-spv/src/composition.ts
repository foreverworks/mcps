import { join } from "node:path";

import { type HttpFailure, inputFilesFrom, makeHttp, readSecret } from "@foreverworks/mcp-kit";

import type { Deps, DukPort } from "./app/ports.js";
import { ATTACHMENT_MAX_BYTES } from "./domain/contact.js";
import { asAppError, configError, fail } from "./domain/errors.js";
import { type Cookies, sameCookies } from "./domain/session.js";
import { makeBrowser } from "./infra/browser.js";
import { type AppConfig, configFrom, type UpstreamSetting } from "./infra/config.js";
import { makeFiles, sha256 } from "./infra/files.js";
import { makeAlertSource } from "./infra/mail/alerts.js";
import { type MailConfig, makeCodeSource } from "./infra/mail/source.js";
import { makeKits } from "./infra/duk/kit.js";
import { makeDuk } from "./infra/duk/run.js";
import { makeForms } from "./infra/portal/forms.js";
import { makeStare } from "./infra/stare.js";
import { makeLogin, makePortal } from "./infra/portal/portal.js";
import { makeContactLedger, makeCuiOnly, makeDeclarationLedger, makeExclusive, makeFormsLock, makeLedger, makePortalLock, makeSessionStore } from "./infra/store.js";
import { type Connect, makeConnect, type Source, type TransportFor } from "./infra/upstream/mcp.js";
import { makeCredentialSource, type VaultConfig } from "./infra/vault.js";

/**
 * The composition root: the only module naming both a port and what
 * implements it. Built once per process; under a service that one process
 * serves every client, so the session and the sign-in lock are shared.
 * Nothing here touches the network: the first call that needs SPV signs in.
 */
export type BuildOptions = {
  /** SPV's fetch; tests pass a fake portal. */
  readonly fetch?: typeof fetch;
  /** How the mail and vault MCP connections are made; tests pass in-memory servers. */
  readonly transportFor?: TransportFor;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly pollMs?: number;
  /** DUKIntegrator; tests pass a fake, so they need no Java. */
  readonly duk?: DukPort;
};

/** ANAF's static files (the DUKIntegrator kits): a 5xx or a dropped connection is tried again, anything else fails the kit's build. */
const failStatic = (failure: HttpFailure): never =>
  fail({ kind: "api", status: failure.kind === "transport" ? 0 : failure.status, message: `static.anaf.ro: ${failure.message}` });

/** ANAF's status service: a 5xx or a dropped connection is tried again (a lookup changes nothing). */
const failStare = (failure: HttpFailure): never =>
  fail({ kind: "api", status: failure.kind === "transport" ? 0 : failure.status, message: `stare.anaf.ro: ${failure.message}` });

export type Built = { readonly deps: Deps; readonly config: AppConfig; readonly stop: () => void };

const connectFor = (source: Source, setting: UpstreamSetting, transportFor: TransportFor | undefined): Connect =>
  setting.kind === "endpoint"
    ? makeConnect(source, setting.endpoint, transportFor)
    : async () => fail(configError(setting.kind === "invalid" ? setting.message : `no ${source} MCP server is configured`));

const vaultConfig = (env: NodeJS.ProcessEnv, config: AppConfig, transportFor: TransportFor | undefined): VaultConfig => {
  const v = config.vault;
  if (v.upstream.kind !== "none") {
    const args = v.args;
    return {
      kind: "mcp",
      connect: args.ok ? connectFor("vault", v.upstream, transportFor) : async () => fail(configError(args.message)),
      transport: v.upstream.kind === "endpoint" ? v.upstream.transport : "http",
      tool: v.tool,
      argsTemplate: args.ok ? args.value : {},
      item: v.item,
      passwordField: v.passwordField,
      usernameField: v.usernameField,
      username: v.username,
    };
  }
  if (v.passwordFile !== undefined || v.passwordVariable) {
    return {
      kind: "static",
      from: v.passwordFile !== undefined ? "file" : "variable",
      username: v.username,
      password: () => readSecret(env, { file: "ANAF_SPV_PASSWORD_FILE", value: "ANAF_SPV_PASSWORD" }, (message) => fail(configError(message))),
    };
  }
  return { kind: "none", missing: "set ANAF_SPV_VAULT_MCP_URL (or _COMMAND) with ANAF_SPV_VAULT_ITEM, or ANAF_SPV_PASSWORD_FILE with ANAF_SPV_USERNAME" };
};

const mailConfig = (config: AppConfig, transportFor: TransportFor | undefined): MailConfig => {
  const m = config.mail;
  if (m.driverProblem !== undefined) return { driver: "manual", why: m.driverProblem };
  if (m.driver === "manual") return { driver: "manual", why: "ANAF_SPV_MAIL_DRIVER is manual" };
  if (m.upstream.kind === "none") return { driver: "manual", why: "no mail MCP server is configured (ANAF_SPV_MAIL_MCP_URL or ANAF_SPV_MAIL_MCP_COMMAND)" };
  const args = m.args;
  return {
    driver: m.driver ?? "auto",
    connect: args !== undefined && !args.ok ? async () => fail(configError(args.message)) : connectFor("mail", m.upstream, transportFor),
    transport: m.upstream.kind === "endpoint" ? m.upstream.transport : "http",
    endpoint: m.upstream.kind === "endpoint" ? m.upstream.label : "(invalid)",
    query: m.query,
    account: m.account,
    tool: m.tool,
    argsTemplate: args?.ok === true ? args.value : undefined,
  };
};

export const buildDeps = (env: NodeJS.ProcessEnv = process.env, options: BuildOptions = {}): Built => {
  const config = configFrom(env);
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const pollMs = options.pollMs ?? 3_000;
  const browser = makeBrowser(config.portal, options.fetch === undefined ? {} : { fetch: options.fetch });
  const store = makeSessionStore(config.stateDir);
  const mail = mailConfig(config, options.transportFor);
  const portal = makePortal(browser, store, now, makePortalLock(config.stateDir));
  const formsBrowser = makeBrowser(config.formsPortal, options.fetch === undefined ? {} : { fetch: options.fetch });
  const formsStore = makeSessionStore(config.stateDir, "forms-");
  const staticHttp = makeHttp({
    service: "static.anaf.ro",
    isRetryable: (status) => status >= 500,
    fail: failStatic,
    attempts: 3,
    timeoutMs: 60_000,
    headers: { "user-agent": "mcp-anaf-spv (DUKIntegrator kit)" },
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  const stareHttp = makeHttp({
    service: "stare.anaf.ro",
    isRetryable: (status) => status >= 500,
    fail: failStare,
    attempts: 3,
    timeoutMs: 30_000,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  const deps: Deps = {
    login: makeLogin(browser),
    portal,
    store,
    credentials: makeCredentialSource(vaultConfig(env, config, options.transportFor)),
    codes: makeCodeSource(mail, { now, sleep, everyMs: Math.min(pollMs, 2_000) }),
    alerts: makeAlertSource(mail),
    files: makeFiles(config.downloadsDir),
    ledger: makeLedger(config.stateDir),
    contacts: makeContactLedger(config.stateDir),
    cuiOnly: makeCuiOnly(config.stateDir, now),
    duk: options.duk ?? makeDuk({ java: config.java, workRoot: join(config.stateDir, "work"), kits: makeKits(config.dukDir, staticHttp, now) }),
    declarations: makeDeclarationLedger(config.stateDir),
    stare: makeStare(stareHttp, config.statusService),
    forms: {
      site: { name: "formularespv-pf", login: makeLogin(formsBrowser), store: formsStore },
      pages: makeForms(formsBrowser, formsStore, now, makeFormsLock(config.stateDir)),
      url: config.formsPortal,
    },
    inputFiles: inputFilesFrom(env, { maxBytes: ATTACHMENT_MAX_BYTES }),
    exclusive: makeExclusive(config.stateDir),
    sha256,
    now,
    sleep,
    codeWaitMs: config.codeWaitMs,
    pollMs: options.pollMs ?? 5_000,
    portalUrl: config.portal,
  };
  const stop = keepalive(deps, config.keepaliveMin);
  return { deps, config, stop };
};

/**
 * With ANAF_SPV_KEEPALIVE_MIN, load one page every N minutes while a session
 * is stored, so SPV's idle timeout does not end it between tasks (each new
 * sign-in e-mails the user a code). A failure is ignored: the next call signs
 * in again.
 */
const keepalive = (deps: Deps, minutes: number): (() => void) => {
  if (minutes <= 0) return () => undefined;
  // The cookies of a session the keepalive saw end: not probed again until a sign-in replaces them.
  let dead: Cookies | undefined;
  const tick = async (): Promise<void> => {
    const stored = await deps.store.read();
    if (stored === undefined || (dead !== undefined && sameCookies(stored.cookies, dead))) return;
    await deps.portal.probe().catch((thrown: unknown) => {
      if (asAppError(thrown)?.kind === "session_expired") dead = stored.cookies;
    });
  };
  const timer = setInterval(() => void tick().catch(() => undefined), minutes * 60_000);
  timer.unref();
  return () => clearInterval(timer);
};
