import type { RotatingGrant } from "@foreverworks/mcp-kit";
import { z } from "zod";

/*
 * What this server keeps in its state directory, as it lies on disk. Field names
 * are snake_case and stay so: a file already on someone's disk must keep reading
 * after an upgrade. The shapes in memory are the camelCase types beside them.
 */

/** The client the authorization server registered for this server, and where it signs in. */
export type ClientRegistration = {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly redirectUri: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly scope: string;
};

export const clientOnDisk = z.object({
  issuer: z.string().min(1),
  client_id: z.string().min(1),
  client_secret: z.string().min(1).optional(),
  redirect_uri: z.string().min(1),
  authorization_endpoint: z.string().min(1),
  token_endpoint: z.string().min(1),
  scope: z.string(),
});

export const clientFromDisk = (d: z.infer<typeof clientOnDisk>): ClientRegistration => ({
  issuer: d.issuer,
  clientId: d.client_id,
  ...(d.client_secret === undefined ? {} : { clientSecret: d.client_secret }),
  redirectUri: d.redirect_uri,
  authorizationEndpoint: d.authorization_endpoint,
  tokenEndpoint: d.token_endpoint,
  scope: d.scope,
});

export const clientToDisk = (c: ClientRegistration): z.infer<typeof clientOnDisk> => ({
  issuer: c.issuer,
  client_id: c.clientId,
  ...(c.clientSecret === undefined ? {} : { client_secret: c.clientSecret }),
  redirect_uri: c.redirectUri,
  authorization_endpoint: c.authorizationEndpoint,
  token_endpoint: c.tokenEndpoint,
  scope: c.scope,
});

export const grantOnDisk = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_at_epoch: z.number(),
  scope: z.string().optional(),
});

export const grantFromDisk = (d: z.infer<typeof grantOnDisk>): RotatingGrant => ({
  accessToken: d.access_token,
  refreshToken: d.refresh_token,
  expiresAtEpoch: d.expires_at_epoch,
  ...(d.scope === undefined ? {} : { scope: d.scope }),
});

export const grantToDisk = (g: RotatingGrant): z.infer<typeof grantOnDisk> => ({
  access_token: g.accessToken,
  refresh_token: g.refreshToken,
  expires_at_epoch: g.expiresAtEpoch,
  ...(g.scope === undefined ? {} : { scope: g.scope }),
});

/** A tool as the upstream lists it: what is needed to offer it again under its own name. */
export type ToolSpec = {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
};

export const toolsOnDisk = z.object({
  fetched_at_epoch: z.number(),
  tools: z.array(z.object({ name: z.string().min(1), title: z.string().optional(), description: z.string().optional(), input_schema: z.record(z.string(), z.unknown()) })),
});

export type ToolCache = { readonly fetchedAtEpoch: number; readonly tools: readonly ToolSpec[] };

export const toolsFromDisk = (d: z.infer<typeof toolsOnDisk>): ToolCache => ({
  fetchedAtEpoch: d.fetched_at_epoch,
  tools: d.tools.map((t) => ({ name: t.name, ...(t.title === undefined ? {} : { title: t.title }), ...(t.description === undefined ? {} : { description: t.description }), inputSchema: t.input_schema })),
});

export const toolsToDisk = (c: ToolCache): z.infer<typeof toolsOnDisk> => ({
  fetched_at_epoch: c.fetchedAtEpoch,
  tools: c.tools.map((t) => ({ name: t.name, ...(t.title === undefined ? {} : { title: t.title }), ...(t.description === undefined ? {} : { description: t.description }), input_schema: { ...t.inputSchema } })),
});
