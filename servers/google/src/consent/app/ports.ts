/**
 * What the consent use cases need, named as operations. No URL appears above infra/.
 */
import type { Granted, Random } from "@foreverworks/mcp-kit";

import type { ClientConfig, NewGrant } from "../../domain/credentials.js";
import type { TokenInfo } from "../../domain/tokenInfo.js";
import type { ConsentProduct, Pending } from "../domain/consent.js";

/** Where one product's grant for one account goes, what it must carry, and who must approve it. */
export type Target = {
  readonly product: ConsentProduct;
  readonly account: string;
  /** The address the approving Google account must have. */
  readonly address: string;
  /** Every scope the product needs; a grant without one is refused. */
  readonly scopes: readonly string[];
  /** Scopes asked for as well, which the grant may come back without: what only some accounts can give (a Workspace directory). */
  readonly optionalScopes?: readonly string[];
  /** Where the server reads this grant: the file a consent writes. */
  readonly credentialsPath: string;
  /** The OAuth client to ask on. Resolved only when a consent begins; a completion uses the one it began with. */
  readonly client: () => Promise<ClientConfig>;
  /** Drop what the product built on the grant being replaced, so the next call uses the new one. */
  readonly forget: () => Promise<void>;
};

export type PendingStore = {
  readonly put: (pending: Pending) => Promise<void>;
  /** The waiting consent for this state, removed as it is taken: single use. Undefined when none, or expired. */
  readonly take: (state: string, now: number) => Promise<Pending | undefined>;
};

export type Deps = {
  readonly target: (product: ConsentProduct, account: string) => Promise<Target>;
  readonly pending: PendingStore;
  readonly exchange: (client: ClientConfig, code: string, redirectUri: string, verifier: string) => Promise<Granted>;
  /** What Google says about an access token: who it belongs to. */
  readonly whoApproved: (accessToken: string) => Promise<TokenInfo>;
  readonly save: (path: string, grant: NewGrant) => Promise<void>;
  readonly authUri: string;
  /** A loopback URI nothing listens on: the redirect fails to load and the URL is read from the browser's address bar. */
  readonly redirectUri: string;
  /** Epoch milliseconds. */
  readonly now: () => number;
  readonly random?: Random;
};
