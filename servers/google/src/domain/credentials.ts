/**
 * The two halves of a grant as this server keeps it (infra/credentials.ts
 * reads and writes the file). Pure types.
 */

/** An OAuth client: who a grant was issued to, and where its tokens are minted. */
export type ClientConfig = {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly tokenUri: string;
};

/** A grant as a consent produced it, before it is a file. */
export type NewGrant = {
  readonly client: ClientConfig;
  readonly refreshToken: string;
  readonly scopes: readonly string[];
  /** The address the grant resolved to, which health checks it against later. */
  readonly account: string;
};
