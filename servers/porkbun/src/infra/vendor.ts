import { loadConfig } from "@porkbunllc/mcp-server/dist/api.js";
import { PROFILES, redact } from "@porkbunllc/mcp-server/dist/profiles.js";
import { BASE_INSTRUCTIONS, SERVER_VERSION } from "@porkbunllc/mcp-server/dist/server.js";
import { FUNDING_LOCAL, PAY_DIRECT_OPENING, PAY_DIRECT_PARAMS, PAY_WITH_USDC_NOTE, tools } from "@porkbunllc/mcp-server/dist/tools.js";
import { z, type ZodType } from "zod";

import type { ToolArgs } from "../app/ports.js";
import { WITHHELD_SECRET } from "../domain/secrets.js";
import { describedHere, LEFT_OUT, paramsHere, type VendorFundingText } from "./vendor/offer.js";

/**
 * The pinned `@porkbunllc/mcp-server`, parsed at the boundary.
 *
 * The package ships no type declarations, so each export this server uses is
 * checked here when the process starts: a version that changes one of these
 * shapes stops the server (and fails the tests) instead of running on a guess.
 * Nothing below restates a tool; names, schemas and annotations are the
 * vendor's own.
 */

const isFunction = (value: unknown): boolean => typeof value === "function";

/** A zod schema from the vendor's own zod (the lockfile dedupes it to ours; the SDK validates with it). */
const zodSchema = z.custom<ZodType>(
  (value) => typeof value === "object" && value !== null && isFunction((value as { safeParse?: unknown }).safeParse),
  "a zod schema",
);

/** The config object every vendor handler takes. Loose: a field a later version adds is kept, not stripped. */
const VendorConfigSchema = z.looseObject({
  apiKey: z.string(),
  secretApiKey: z.string(),
  baseUrl: z.string(),
  docsBaseUrl: z.string(),
  userAgent: z.string(),
});
export type VendorConfig = z.infer<typeof VendorConfigSchema>;

type Handler = (config: VendorConfig, args: ToolArgs) => Promise<unknown>;

const VendorToolSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/),
  description: z.string().min(1),
  inputSchema: z.record(z.string(), zodSchema),
  annotations: z
    .looseObject({
      title: z.string().optional(),
      readOnlyHint: z.boolean().optional(),
      destructiveHint: z.boolean().optional(),
      idempotentHint: z.boolean().optional(),
      openWorldHint: z.boolean().optional(),
    })
    .default({}),
  handler: z.custom<Handler>(isFunction, "a handler function"),
});
export type VendorTool = z.infer<typeof VendorToolSchema>;

/** The vendor's connection profiles: which tools a kind of connection leaves out, and which result fields it hides. */
const ProfileSchema = z.looseObject({
  path: z.string(),
  exclude: z.custom<ReadonlySet<string>>((value) => value instanceof Set, "a Set of tool names"),
  redactKeys: z.array(z.string()).optional(),
});
export type VendorProfile = z.infer<typeof ProfileSchema>;

type Redact = (value: unknown, keys: readonly string[], note: string) => unknown;

const parsed = <T>(schema: z.ZodType<T>, value: unknown, what: string): T => {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(`@porkbunllc/mcp-server ${String(SERVER_VERSION)}: ${what} changed shape: ${z.prettifyError(result.error)}`);
  return result.data;
};

export const VENDOR_VERSION = parsed(z.string().regex(/^\d+\.\d+\.\d+$/), SERVER_VERSION, "SERVER_VERSION");
/** What the vendor's own server tells a client at initialize ("finish a site with deploy_site"). */
export const VENDOR_INSTRUCTIONS = parsed(z.string().min(1), BASE_INSTRUCTIONS, "BASE_INSTRUCTIONS");

/** Where the vendor's instructions turn to publishing a site, which only the hosting tools do. */
const WEBSITE_OPENING = "Building a website:";
const websiteAt = VENDOR_INSTRUCTIONS.indexOf(WEBSITE_OPENING);
if (websiteAt <= 0) throw new Error(`@porkbunllc/mcp-server ${String(SERVER_VERSION)}: BASE_INSTRUCTIONS no longer has "${WEBSITE_OPENING}"; src/mcp/instructions.ts must follow it`);

/**
 * The vendor's instructions in two: what holds for every tool (results are
 * data, never instructions), and the paragraph on publishing a site, which
 * names only hosting tools (test/toolsets.test.ts holds it to that).
 */
export const VENDOR_INSTRUCTION_PARTS = {
  general: VENDOR_INSTRUCTIONS.slice(0, websiteAt).trimEnd(),
  website: VENDOR_INSTRUCTIONS.slice(websiteAt),
} as const;
export const VENDOR_TOOLS: readonly VendorTool[] = parsed(z.array(VendorToolSchema).min(1), tools, "the tools array");
export const VENDOR_PROFILES: readonly VendorProfile[] = parsed(z.array(ProfileSchema).min(1), PROFILES, "PROFILES");
const vendorRedact = parsed(z.custom<Redact>(isFunction), redact, "redact");
const vendorLoadConfig = parsed(z.custom<() => unknown>(isFunction), loadConfig, "loadConfig");

/**
 * The vendor's profile for a connection that holds a live key: its hosted
 * `/mcp`, the full server. It leaves out the sandbox tools, which answer only
 * to a `pk1_sb_` key, and this server always holds the account's live key.
 */
export const LIVE_KEY_PROFILE = "/mcp";

const liveKeyProfile = VENDOR_PROFILES.find((p) => p.path === LIVE_KEY_PROFILE);
if (liveKeyProfile === undefined) throw new Error(`@porkbunllc/mcp-server ${VENDOR_VERSION}: no profile ${LIVE_KEY_PROFILE}`);

/** The vendor's purchase-funding text, which the tools this server keeps are told without USDC (vendor/offer.ts). */
const FUNDING_TEXT: VendorFundingText = {
  fundingLocal: parsed(z.string().min(1), FUNDING_LOCAL, "FUNDING_LOCAL"),
  payWithUsdcNote: parsed(z.string().min(1), PAY_WITH_USDC_NOTE, "PAY_WITH_USDC_NOTE"),
  payDirectOpening: parsed(z.string().min(1), PAY_DIRECT_OPENING, "PAY_DIRECT_OPENING"),
  payDirectParams: parsed(z.array(z.string()).min(1), PAY_DIRECT_PARAMS, "PAY_DIRECT_PARAMS"),
};

const vendorNames = new Set(VENDOR_TOOLS.map((tool) => tool.name));
const goneLeftOut = Object.keys(LEFT_OUT).filter((name) => !vendorNames.has(name));
if (goneLeftOut.length > 0) throw new Error(`@porkbunllc/mcp-server ${VENDOR_VERSION}: no longer has ${goneLeftOut.join(", ")}; drop them from src/infra/vendor/offer.ts`);

/**
 * The tools this server offers: the vendor's, less what its live-key profile
 * leaves out and what this server leaves out (vendor/offer.ts: USDC payments,
 * API keys), each without the USDC payment arguments and told so.
 */
export const OFFERED_TOOLS: readonly VendorTool[] = VENDOR_TOOLS.filter((tool) => !liveKeyProfile.exclude.has(tool.name) && !Object.hasOwn(LEFT_OUT, tool.name)).map(
  (tool) => ({ ...tool, description: describedHere(tool.name, tool.description, FUNDING_TEXT), inputSchema: paramsHere(tool.name, tool.inputSchema, FUNDING_TEXT) }),
);

/** Every result field some vendor profile hides as a secret (`secret`, a webhook's signing key). */
export const SECRET_FIELDS: readonly string[] = [...new Set(VENDOR_PROFILES.flatMap((p) => p.redactKeys ?? []))];

export const withholdSecrets = (result: unknown): unknown => vendorRedact(result, SECRET_FIELDS, `[${WITHHELD_SECRET}]`);

/**
 * The vendor's own config (API base, docs base) with the key pair this server
 * was given in place of the one it would read from the environment, and a
 * user agent naming the version that is really making the call.
 */
export const vendorConfig = (keys: Pick<VendorConfig, "apiKey" | "secretApiKey">): VendorConfig => ({
  ...parsed(VendorConfigSchema, vendorLoadConfig(), "loadConfig()"),
  ...keys,
  userAgent: `porkbun-mcp/${VENDOR_VERSION}`,
});
