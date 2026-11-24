import type { Granted, GrantSource, OAuthEndpoints, PendingPkceAuthorization, RegisteredClient, RotatingGrant, StoredFile } from "@foreverworks/mcp-kit";

import type { ClientRegistration, ToolCache, ToolSpec } from "../domain/schema.js";

export type Config = {
  /** Granola's own MCP server. */
  readonly upstreamUrl: string;
  /** Where the browser lands after sign-in; it need not be listening. */
  readonly redirectUri: string;
  /** The scopes to ask for, when the deployment says; else derived from what Granola offers. */
  readonly scope?: string;
  readonly clientName: string;
};

/** The sign-in service: discovery, registration, and the token endpoint. */
export type OAuthPort = {
  readonly discover: (upstreamUrl: string) => Promise<OAuthEndpoints>;
  readonly register: (endpoints: OAuthEndpoints, redirectUri: string, scope: string, clientName: string) => Promise<RegisteredClient>;
  readonly exchange: (client: ClientRegistration, code: string, verifier: string) => Promise<Granted>;
  readonly refresh: (client: ClientRegistration, refreshToken: string) => Promise<Granted>;
};

/** A tool's answer from Granola, as Granola gave it. */
export type UpstreamResult = {
  readonly content: readonly unknown[];
  readonly structuredContent?: Readonly<Record<string, unknown>>;
  readonly isError?: true;
};

/** Granola's MCP server, reached with the grant's access token. */
export type UpstreamPort = {
  readonly listTools: () => Promise<readonly ToolSpec[]>;
  readonly callTool: (name: string, args: Readonly<Record<string, unknown>>) => Promise<UpstreamResult>;
};

export type Stores = {
  readonly client: StoredFile<ClientRegistration>;
  /** A registration made by a sign-in that has not completed: promoted to `client` only when it does, so a working grant keeps its client. */
  readonly candidate: StoredFile<ClientRegistration>;
  readonly pending: StoredFile<PendingPkceAuthorization>;
  readonly grant: StoredFile<RotatingGrant>;
  readonly tools: StoredFile<ToolCache>;
};

/** What the use cases run on; composition.ts is the only place that builds it. */
export type Deps = {
  readonly config: Config;
  /** Seconds since the epoch. */
  readonly now: () => number;
  readonly oauth: OAuthPort;
  readonly stores: Stores;
  readonly access: GrantSource;
  readonly upstream: UpstreamPort;
  /** The upstream tools last seen, for registering them: synchronous because a server is built per request. */
  readonly knownTools: () => readonly ToolSpec[];
  readonly rememberTools: (tools: readonly ToolSpec[]) => Promise<void>;
};
