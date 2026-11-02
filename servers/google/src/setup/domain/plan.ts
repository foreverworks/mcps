import { LABEL } from "../../domain/accounts.js";
import { USERINFO_EMAIL } from "../../domain/scopes.js";
import { CONSENT_PRODUCTS, type ConsentProduct } from "../../consent/domain/consent.js";
import { CONSENT_APIS, CONSENT_SCOPES } from "../../consent/domain/products.js";
import { ALL_TOOLSETS, GRANT_TOOLSETS, type Toolset } from "../../mcp/policy.js";

/**
 * What `setup` decides from a person's answers, as pure functions: which
 * grants to make, which APIs to enable, which scopes to declare, which console
 * pages to open, and the lines that add the server to a client. Every list is
 * derived from the tables the server itself runs on (the toolsets, the
 * consent scopes and APIs), so setup cannot ask for less or more than the
 * server will use.
 */

/** A parse that either worked or says, in one sentence, why not. */
export type Parsed<T> = { readonly ok: T } | { readonly problem: string };

/** The toolsets a person named: commas or spaces between them; empty or `all` is every one. */
export const parseToolsets = (answer: string): Parsed<readonly Toolset[]> => {
  const names = answer
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean);
  if (names.length === 0 || (names.length === 1 && names[0] === "all")) return { ok: ALL_TOOLSETS };
  const unknown = names.filter((n) => !(ALL_TOOLSETS as readonly string[]).includes(n));
  if (unknown.length > 0) return { problem: `${unknown.join(", ")} ${unknown.length === 1 ? "is not a product" : "are not products"}; choose from ${ALL_TOOLSETS.join(", ")}` };
  return { ok: ALL_TOOLSETS.filter((t) => names.includes(t)) };
};

/** The grants a set of toolsets runs on, in the order consent lists its products. */
export const consentProductsOf = (toolsets: readonly Toolset[]): readonly ConsentProduct[] =>
  CONSENT_PRODUCTS.filter((p) => (GRANT_TOOLSETS[p] as readonly Toolset[]).some((t) => toolsets.includes(t)));

/** Every API those grants' tools call, once each. */
export const apisOf = (products: readonly ConsentProduct[]): readonly string[] => [...new Set(products.flatMap((p) => CONSENT_APIS[p]))];

/** Every scope the consents will ask for, once each: what to add on the Data Access page. userinfo.email comes with every one. */
export const scopesOf = (products: readonly ConsentProduct[]): readonly string[] => [
  ...new Set([...products.flatMap((p) => [...CONSENT_SCOPES[p].required, ...CONSENT_SCOPES[p].optional]), USERINFO_EMAIL]),
];

/** The scopes only some accounts can grant, which a person may leave unticked (a Workspace directory). */
export const optionalScopesOf = (products: readonly ConsentProduct[]): readonly string[] => [...new Set(products.flatMap((p) => CONSENT_SCOPES[p].optional))];

/**
 * The account labels a person named: commas or spaces between them, each
 * lowercase letters, digits and hyphens. `state` names the token-cache folder
 * beside the grants, so it cannot be an account.
 */
export const parseLabels = (answer: string): Parsed<readonly string[]> => {
  const labels = [...new Set(answer.split(/[\s,]+/).filter(Boolean))];
  if (labels.length === 0) return { problem: "name at least one account" };
  const bad = labels.filter((l) => !LABEL.test(l));
  if (bad.length > 0) return { problem: `${bad.join(", ")}: a label is lowercase letters, digits and hyphens, starting with a letter or digit` };
  if (labels.includes("state")) return { problem: `"state" is the name of a folder the server keeps its caches in; pick another label` };
  return { ok: labels };
};

/**
 * Google's rule for a project ID: 6 to 30 characters, lowercase letters,
 * digits and hyphens, starting with a letter and not ending with a hyphen.
 */
export const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

/** A fresh project ID for gcloud to create: `mcp-google-` and six random characters, since IDs are unique across all of Google Cloud. */
export const newProjectId = (random: () => number = Math.random): string =>
  `mcp-google-${Array.from({ length: 6 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(random() * 36)]).join("")}`;

const CONSOLE = "https://console.cloud.google.com";

/**
 * The console pages setup opens, each pinned to the project with `project=`,
 * because without it the console shows whichever project was open last.
 * Checked by hand in the console on 2026-11-02.
 */
export const consoleLinks = (projectId: string, apis: readonly string[]) => {
  const project = `project=${encodeURIComponent(projectId)}`;
  return {
    /** The API Library's flow that enables several APIs in one go. */
    enableApis: `${CONSOLE}/apis/enableflow?apiid=${apis.join(",")}&${project}`,
    /** Google Auth Platform's start: a wizard on a new project, the overview once it is configured. */
    overview: `${CONSOLE}/auth/overview?${project}`,
    branding: `${CONSOLE}/auth/branding?${project}`,
    audience: `${CONSOLE}/auth/audience?${project}`,
    dataAccess: `${CONSOLE}/auth/scopes?${project}`,
    createClient: `${CONSOLE}/auth/clients/create?${project}`,
  };
};

/** Where a person creates a project in the console. */
export const PROJECT_CREATE_URL = `${CONSOLE}/projectcreate`;

/**
 * What an External app's Branding page needs before Google lets it be
 * published (observed 2026-11-02: Publish app stays disabled, "complete your
 * configuration on the Branding page", until a home page and a privacy policy
 * on an authorized domain are set). This server's own pages serve, since the
 * app a person makes is a copy of it; their own pages work as well.
 */
export const APP_DOMAIN = {
  homePage: "https://github.com/foreverworks/mcps/tree/main/servers/google",
  privacyPolicy: "https://github.com/foreverworks/mcps/blob/main/servers/google/PRIVACY.md",
  domain: "github.com",
} as const;

/** One approval to ask for: a product's grant for an account. */
export type Step = { readonly product: ConsentProduct; readonly account: string };

/**
 * The approvals to ask for, account by account so a person signs in to each
 * Google account once: every chosen product for every label, except Drive,
 * which holds one grant and is consented only for the account it should reach.
 */
export const consentSteps = (products: readonly ConsentProduct[], labels: readonly string[], driveAccount: string | undefined): readonly Step[] =>
  labels.flatMap((account) => products.filter((p) => p !== "drive" || account === (driveAccount ?? labels[0])).map((product) => ({ product, account })));

/** The package as a person installs it. */
export const PACKAGE = "@foreverworks/mcp-google";

/**
 * The server's own variables that, set while setup ran, decided where it
 * wrote, so the client must start the server with them too. A variable not
 * set is left out: the defaults are what setup used.
 */
export const LOCATION_VARIABLES = [
  "GOOGLE_STATE_DIR",
  "GOOGLE_OAUTH_CLIENT_FILE",
  "GMAIL_MODIFY_ACCOUNTS",
  "GMAIL_ADDRESSES",
  "GMAIL_STATE_DIR",
  "CALENDAR_ROOT",
  "DRIVE_CREDENTIALS",
  "GOOGLE_EDITORS_ROOT",
  "TASKS_ROOT",
  "CONTACTS_ROOT",
  "MEET_ROOT",
  "XDG_STATE_HOME",
] as const;

/** Each location variable set in this environment, with its value. */
export const carriedVariables = (env: NodeJS.ProcessEnv): readonly (readonly [string, string])[] =>
  LOCATION_VARIABLES.flatMap((name) => {
    const value = env[name]?.trim();
    return value ? [[name, value] as const] : [];
  });

const shellQuote = (value: string): string => (/^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`);

/**
 * How to add the server to a client once setup is done: the Claude Code
 * command and the JSON Claude Desktop and most other clients read. With every
 * product chosen and the default locations, neither sets a variable; a subset
 * of products is passed as GOOGLE_TOOLSETS, which keeps the others' tool
 * definitions out of every request.
 */
export const installLines = (toolsets: readonly Toolset[], carried: readonly (readonly [string, string])[]) => {
  const env: readonly (readonly [string, string])[] = [
    ...(toolsets.length < ALL_TOOLSETS.length ? [["GOOGLE_TOOLSETS", toolsets.join(",")] as const] : []),
    ...carried,
  ];
  const flags = env.map(([name, value]) => `-e ${name}=${shellQuote(value)} `).join("");
  const claudeCode = `claude mcp add google ${flags}-- npx -y ${PACKAGE}`;
  const server = { command: "npx", args: ["-y", PACKAGE], ...(env.length ? { env: Object.fromEntries(env) } : {}) };
  const desktop = JSON.stringify({ mcpServers: { google: server } }, null, 2);
  return { claudeCode, desktop };
};
