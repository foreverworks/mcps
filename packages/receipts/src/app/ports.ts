/**
 * What every receipts server's use cases need besides its own app's API port,
 * stated as functions rather than objects with behaviour. The infra layer
 * (this package's, packages/receipts/src/infra) satisfies them.
 */

/** Raw order details that have stopped changing, kept across processes. */
export type OrderStore<Raw> = {
  readonly read: (orderId: number) => Promise<Raw | undefined>;
  readonly write: (orderId: number, details: Raw) => Promise<void>;
  readonly count: () => Promise<number>;
};

/** A file as written: where, and what, so a reader can check it is the same bytes. */
export type Written = { readonly path: string; readonly sha256: string; readonly size: number };

export type FilePort = {
  /** Writes `text` (UTF-8) to `dir/name`, whole or not at all. */
  readonly writeText: (dir: string, name: string, text: string) => Promise<Written>;
};

/** The credentials file: the variable that names it, and its path when that is set. There is no default. */
export type CredentialsFile = { readonly variable: string; readonly path: string | undefined };

export type Paths = {
  readonly credentials: CredentialsFile;
  readonly stateDir: string;
  readonly ordersDir: string;
  readonly exportsDir: string;
};

/** A server's deps, minus the port to its app's API, which each server names for its app (`bolt`, `glovo`). */
export type BaseDeps<Raw, Facts> = {
  readonly store: OrderStore<Raw>;
  readonly files: FilePort;
  readonly paths: Paths;
  /** What the refresh token says about itself; read from disk, never from the network. */
  readonly tokenFacts: () => Promise<Facts>;
  /** The IANA zone local dates are read in (`<PREFIX>_TIME_ZONE`). */
  readonly timeZone: string;
  readonly now: () => number;
};
