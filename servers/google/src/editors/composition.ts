import { fileTokenStore } from "@foreverworks/mcp-kit";

import type { Deps as DriveDeps } from "../drive/app/ports.js";
import { depsFor, type DriveGrant } from "../drive/composition.js";
import { ALL_ACCOUNTS, LABEL } from "../domain/accounts.js";
import { loadCredentials } from "../infra/credentials.js";
import { makeRequest, type Request } from "../infra/httpJson.js";
import { makeTokenProvider, type TokenProvider } from "../infra/oauth.js";
import type { EditorApi, HealthDeps } from "./app/ports.js";
import { configError, fail } from "./domain/errors.js";
import { makeProbe } from "./infra/probe.js";
import { type Config, credentialsPathOf, defaultOf, discover, type Fs, type GrantSpec, resolveConfig } from "./infra/registry.js";

/**
 * Docs, Sheets and Slides count their quotas per minute, like Drive, so a
 * rate-limit refusal waits at least this long: the general curve (1s, 2s, 4s,
 * 8s) spends every attempt before the bucket refills. Drive measured it
 * (drive/composition.ts); these three have the same per-minute buckets.
 */
const QUOTA_FLOOR_MS = 22_000;

const SERVICES: Readonly<Record<EditorApi, string>> = { docs: "Google Docs", sheets: "Google Sheets", slides: "Google Slides" };

/** One account's grant, and the pieces every product builds on it. */
export type EditorAccount = {
  readonly label: string;
  readonly source: "drive" | "credentials";
  /** Where the grant is read from, named, never its contents. */
  readonly detail: string;
  /** An authenticated, retrying request for one of the three APIs. */
  readonly request: (api: EditorApi) => Request;
  /** The Drive product's adapter and use cases, under this same grant: create in a folder, copy, resolve a path. */
  readonly drive: DriveDeps;
  readonly health: HealthDeps;
};

export type Editors = {
  readonly root: string;
  /** The grants as they are on disk now, the default first. */
  readonly specs: () => readonly GrantSpec[];
  readonly defaultLabel: () => string;
  /** One account; an empty label means the default. Fails with the remedy when there is no grant. */
  readonly account: (label?: string) => EditorAccount;
  /** The label that runs on the Drive grant when it has no directory of its own (GOOGLE_EDITORS_DRIVE_ACCOUNT); empty when none does. */
  readonly driveLabel: string;
  /** Where an account's own grant is, or goes: `<root>/<label>/credentials.json`. */
  readonly credentialsPath: (label: string) => string;
  /**
   * An account's grant was replaced (a consent): drop what was built on it and
   * its cached token, so the next call reads the grant as it is on disk now.
   */
  readonly forget: (label: string) => Promise<void>;
};

const NO_ACCOUNT =
  "no Docs/Sheets/Slides account is configured: consent one with begin_consent (product editors), or set GOOGLE_EDITORS_DRIVE_ACCOUNT to run one on the Drive grant";

const missing = (config: Config, wanted: string, have: readonly GrantSpec[]): string =>
  `no Docs/Sheets/Slides grant for "${wanted}" (have: ${have.map((s) => s.label).join(", ") || "none"}). ` +
  `Add one with begin_consent (product editors, account ${wanted}); it is saved as ${config.root}/${wanted}/credentials.json ` +
  "and the next call picks it up";

/**
 * The grant registry the three products share.
 *
 * The label GOOGLE_EDITORS_DRIVE_ACCOUNT names runs on the Drive product's
 * grant and its very Drive deps: the SAME token provider (one cache, one
 * refresh), because the Drive grant carries the full `drive` scope, which
 * Docs, Sheets and Slides all accept. Every other account is a directory
 * holding a credentials.json, discovered on each call, so a grant added later
 * needs no restart and no change here.
 *
 * Accounts are built lazily and then kept: the token cache lives inside, and
 * rebuilding it per call would refresh on every use.
 */
export const buildEditors = (
  env: NodeJS.ProcessEnv,
  onDrive: { readonly grant: DriveGrant; readonly drive: DriveDeps },
  fs?: Fs,
): Editors => {
  const config = resolveConfig(env);
  const built = new Map<string, EditorAccount>();
  const specs = () => discover(config, fs);

  const build = (spec: GrantSpec): EditorAccount => {
    const fromDrive = spec.source === "drive";
    const detail = fromDrive ? "the Drive grant (see the drive section)" : spec.credentials;
    const tokens: TokenProvider = fromDrive
      ? onDrive.grant.tokens
      : makeTokenProvider(() => loadCredentials(spec.credentials), fileTokenStore(spec.stateDir));
    // An account on its own grant reads files and saves downloads where the Drive product does.
    const drive = fromDrive
      ? onDrive.drive
      : depsFor(tokens, () => ({ source: "credentials", detail }), onDrive.drive.readInput, onDrive.drive.downloads ? { downloads: onDrive.drive.downloads } : {});
    const request = (api: EditorApi): Request => makeRequest(tokens, { service: SERVICES[api], quotaFloorMs: QUOTA_FLOOR_MS });
    const address = spec.source === "credentials" ? spec.address : undefined;
    return {
      label: spec.label,
      source: spec.source,
      detail,
      request,
      drive,
      health: {
        account: spec.label,
        source: spec.source,
        detail,
        ...(address ? { address } : {}),
        scopes: tokens.scopes,
        whoami: async () => (await drive.drive.about()).user,
        probe: makeProbe(request),
      },
    };
  };

  const account = (label?: string): EditorAccount => {
    const all = specs();
    const wanted = label?.trim() || defaultOf(config, all.map((s) => s.label));
    if (wanted === ALL_ACCOUNTS) return fail(configError(`this tool takes one account, not "${ALL_ACCOUNTS}"`));
    if (wanted === "") return fail(configError(NO_ACCOUNT));
    if (!LABEL.test(wanted)) return fail(configError(`"${wanted}" is not an account label (list_accounts names them)`));
    const existing = built.get(wanted);
    if (existing) return existing;
    const spec = all.find((s) => s.label === wanted) ?? fail(configError(missing(config, wanted, all)));
    const made = build(spec);
    built.set(wanted, made);
    return made;
  };

  const forget = async (label: string): Promise<void> => {
    built.delete(label);
    const spec = specs().find((s) => s.label === label);
    // A directory grant's cache is its own; the Drive grant's belongs to Drive, whose consent forgets it.
    if (spec?.source === "credentials") await fileTokenStore(spec.stateDir).clear?.();
  };

  return {
    root: config.root,
    specs,
    defaultLabel: () => defaultOf(config, specs().map((s) => s.label)),
    account,
    driveLabel: config.driveLabel,
    credentialsPath: (label) => credentialsPathOf(config, label),
    forget,
  };
};

/** One product's deps for one account; an empty label means the default, and a missing grant fails with its remedy. */
export type ProductRegistry<D> = { readonly get: (label?: string) => D };

/**
 * A product's deps per account, built on first use and kept: the one lazy
 * cache Docs, Sheets and Slides share instead of three copies of it.
 */
export const productRegistry = <D>(editors: Editors, build: (account: EditorAccount) => D): ProductRegistry<D> => {
  // Keyed by the account object, not its label: once a consent makes the registry build an account
  // afresh, every product rebuilds on the new one by itself.
  const built = new WeakMap<EditorAccount, D>();
  return {
    get: (label) => {
      const account = editors.account(label);
      const existing = built.get(account);
      if (existing !== undefined) return existing;
      const deps = build(account);
      built.set(account, deps);
      return deps;
    },
  };
};
