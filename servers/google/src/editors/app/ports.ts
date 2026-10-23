/**
 * What the shared health check needs from a grant, named as operations. No
 * URL appears above infra/. The Drive half of a create (a file in a folder, a
 * copy of a template) is the Drive product's own port, not a second one.
 */

/** The three APIs, as the health check names them. */
export const EDITOR_APIS = ["docs", "sheets", "slides"] as const;
export type EditorApi = (typeof EDITOR_APIS)[number];

export type HealthDeps = {
  readonly account: string;
  /** Where the grant is read from, named, never its contents. */
  readonly source: "drive" | "credentials";
  readonly detail: string;
  /** What the credentials file says the grant must resolve to, when it says. */
  readonly address?: string;
  /** The scopes Google granted, as stated when the live token was minted. */
  readonly scopes: () => Promise<readonly string[]>;
  /** The address the grant acts as, from Drive. */
  readonly whoami: () => Promise<string>;
  /**
   * One cheap call to the API about a file that does not exist. Resolves when
   * the API answered at all; throws the API's failure otherwise, which is how
   * a project that never enabled it shows up.
   */
  readonly probe: (api: EditorApi) => Promise<void>;
};
