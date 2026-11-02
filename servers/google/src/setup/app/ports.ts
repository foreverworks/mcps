/**
 * What setup needs from the outside world, named as operations: the person at
 * the terminal, their browser, gcloud, the file system and Google's consent.
 * The flow (setup.ts) knows none of their implementations, which is what lets
 * a test walk it with scripted answers.
 */
import type { ConsentProduct } from "../../consent/domain/consent.js";

/** The person at the terminal. */
export type Terminal = {
  readonly say: (text: string) => void;
  /** A line typed, trimmed; the fallback when they just press Enter. */
  readonly ask: (question: string, fallback?: string) => Promise<string>;
  /** A line typed, or what `wait` finds first; whichever loses is withdrawn. */
  readonly askOrWait: <T>(question: string, wait: (signal: AbortSignal) => Promise<T>) => Promise<{ readonly typed: string } | { readonly found: T }>;
};

/** gcloud, installed and signed in. */
export type Gcloud = {
  readonly account: string;
  readonly createProject: (projectId: string, name: string) => Promise<void>;
  readonly enableApis: (projectId: string, apis: readonly string[]) => Promise<void>;
};

/** A loopback listener for one consent's redirect. */
export type Loopback = {
  /** `http://127.0.0.1:<port>/`, the redirect the consent is begun with. */
  readonly redirectUri: string;
  /** The URL Google's redirect reached, once it does. */
  readonly arrived: (signal: AbortSignal) => Promise<string>;
  readonly close: () => Promise<void>;
};

/** A begun consent, as setup shows it. */
export type Begun = { readonly url: string; readonly address?: string };

/** A finished consent. */
export type Finished = { readonly address: string; readonly path: string };

export type Ports = {
  readonly terminal: Terminal;
  /** Opens a URL in the person's browser; false when there is none to open (an SSH session). */
  readonly open: (url: string) => Promise<boolean>;
  /** gcloud when it is installed and signed in, else undefined. */
  readonly gcloud: () => Promise<Gcloud | undefined>;
  /** Where the server keeps everything, and where setup puts the client. */
  readonly stateDir: string;
  /** Where browsers save downloads. */
  readonly downloadsDir: string;
  /** The client new grants will be made on, if one is set up: its file, where that came from, and its project. */
  readonly existingClient: () => Promise<{ readonly path: string; readonly from: string; readonly projectId?: string } | undefined>;
  /** Waits for a client file to appear in a folder, newer than `since` (epoch ms). */
  readonly watchForClient: (dir: string, since: number) => (signal: AbortSignal) => Promise<string>;
  /** Parsed JSON of a file, or undefined when it cannot be read or parsed. */
  readonly readJson: (path: string) => Promise<unknown>;
  /** Moves a checked client file into place, 0600; returns where it now is. */
  readonly keepClient: (from: string) => Promise<string>;
  readonly listen: () => Promise<Loopback>;
  /** Whether the account already has a grant for the product, and where. */
  readonly existingGrant: (product: ConsentProduct, account: string) => Promise<string | undefined>;
  readonly begin: (product: ConsentProduct, account: string, redirectUri: string) => Promise<Begun>;
  readonly complete: (redirectUrl: string) => Promise<Finished>;
  /** A failure, as one sentence for the person; the server's tagged errors carry the message. */
  readonly describe: (thrown: unknown) => string;
  /** The server's own variables that decided where setup wrote, with their values. */
  readonly carried: readonly (readonly [string, string])[];
  /** Epoch milliseconds. */
  readonly now: () => number;
};
