/**
 * A listed server's plugin, as Claude Code and Cursor read one: its
 * manifests, its MCP configuration and the repository's two marketplaces,
 * each a pure function of the server's package.json (scripts/packaging.ts).
 *
 * The references these follow, read on 2026-11-03:
 *   Claude: https://code.claude.com/docs/en/plugins-reference (plugin.json,
 *   userConfig), .../plugins/marketplace-reference, and the directory's
 *   https://claude.com/docs/plugins/pre-submission-checklist
 *   Cursor: https://cursor.com/docs/reference/plugins (plugin.json,
 *   variables, mcp.json, marketplace.json)
 */
import { keyOf, npxCommand, pluginNameOf, privacyUrl, SITE, userConfig, type Input, type Manifest } from "../packaging.js";

/** Where the plugins live, from the repository's root: one folder per server, named after it. */
export const PLUGINS_DIR = "plugins";

/** A plugin's icon, inside its folder: a copy of the server's 512-pixel PNG, which Claude's directory takes (not the SVG). */
export const ICON = "assets/icon.png";

/** The command a plugin starts the server with: the published package at this exact version, as the directory requires. */
export const pinnedCommand = (m: Manifest): { readonly command: string; readonly args: readonly string[] } => {
  const { command, args } = npxCommand(m);
  return { command, args: args.map((arg) => (arg === m.name ? `${m.name}@${m.version}` : arg)) };
};

/**
 * Claude's `.claude-plugin/plugin.json`: the listing (its icon and the four
 * links the directory reads) and a `userConfig` option per input, which
 * Claude Code asks for when the plugin is enabled.
 */
export const claudePlugin = (m: Manifest, publisher: string): Readonly<Record<string, unknown>> => ({
  name: pluginNameOf(m.server),
  displayName: m.title,
  version: m.version,
  description: m.tagline,
  author: { name: publisher, url: SITE },
  homepage: m.homepage,
  repository: m.repository.url,
  license: m.license,
  keywords: m.keywords,
  icon: `./${ICON}`,
  documentationUrl: m.homepage,
  supportUrl: m.bugs,
  privacyPolicyUrl: privacyUrl,
  ...(m.inputs.length === 0 ? {} : { userConfig: Object.fromEntries(m.inputs.map((i) => [keyOf(i), userConfig(i)])) }),
});

/**
 * Claude's `.mcp.json`. An option nobody set reaches the server as an empty
 * string (Claude Code 2.1.316, tried on 2026-11-03; a required one unset keeps
 * the server from starting), which every server reads as unset: check-docs
 * starts each one that way.
 */
export const claudeMcp = (m: Manifest): Readonly<Record<string, unknown>> => ({
  mcpServers: {
    [m.server]: {
      ...pinnedCommand(m),
      ...(m.inputs.length === 0 ? {} : { env: Object.fromEntries(m.inputs.map((i) => [i.name, `\${user_config.${keyOf(i)}}`])) }),
    },
  },
});

/**
 * A Cursor variable: a value set in Cursor's dashboard (Plugins, Configure)
 * and put where `mcp.json` says `${NAME}`. An optional one defaults to empty,
 * which the server reads as unset, so a placeholder never reaches it as text.
 */
const cursorVariable = (input: Input): Readonly<Record<string, unknown>> => ({
  type: "string",
  title: input.title,
  description: input.description,
  ...(input.required ? {} : { default: "" }),
});

/** Cursor's `.cursor-plugin/plugin.json`, with its `variables` as the JSON Schema Cursor takes. */
export const cursorPlugin = (m: Manifest, publisher: string): Readonly<Record<string, unknown>> => {
  const required = m.inputs.filter((i) => i.required).map((i) => i.name);
  return {
    name: pluginNameOf(m.server),
    version: m.version,
    description: m.tagline,
    author: { name: publisher },
    homepage: m.homepage,
    repository: m.repository.url,
    license: m.license,
    keywords: m.keywords,
    logo: ICON,
    ...(m.inputs.length === 0
      ? {}
      : {
          variables: {
            type: "object",
            properties: Object.fromEntries(m.inputs.map((i) => [i.name, cursorVariable(i)])),
            ...(required.length === 0 ? {} : { required }),
          },
        }),
  };
};

/** Cursor's `mcp.json`: the same command, each input a `${NAME}` variable. */
export const cursorMcp = (m: Manifest): Readonly<Record<string, unknown>> => ({
  mcpServers: {
    [m.server]: {
      ...pinnedCommand(m),
      ...(m.inputs.length === 0 ? {} : { env: Object.fromEntries(m.inputs.map((i) => [i.name, `\${${i.name}}`])) }),
    },
  },
});

/**
 * The repository as a marketplace: where it is on GitHub (`foreverworks/mcps`,
 * which Claude Code adds it from), its name after that (`foreverworks-mcps`),
 * described as its package.json describes it.
 */
export type Marketplace = { readonly slug: string; readonly name: string; readonly description: string; readonly publisher: string };

export const marketplaceOf = (repositoryUrl: string, description: string, publisher: string): Marketplace => {
  const found = /github\.com\/([^/]+)\/([^/.]+)/.exec(repositoryUrl);
  if (found === null) throw new Error(`the repository is not on GitHub: ${repositoryUrl}`);
  const [, owner, repo] = found as unknown as [string, string, string];
  return { slug: `${owner}/${repo}`, name: `${owner}-${repo}`.toLowerCase(), description, publisher };
};

/**
 * Claude's `.claude-plugin/marketplace.json`, at the repository's root: an
 * entry per plugin. Claude Code takes the version from the plugin's own
 * plugin.json, and `claude plugin validate` warns about an entry whose
 * version differs from it, which this one never does.
 */
export const claudeMarketplace = (market: Marketplace, listed: readonly Manifest[]): Readonly<Record<string, unknown>> => ({
  name: market.name,
  owner: { name: market.publisher, url: SITE },
  description: market.description,
  plugins: listed.map((m) => ({
    name: pluginNameOf(m.server),
    displayName: m.title,
    source: `./${PLUGINS_DIR}/${m.server}`,
    description: m.tagline,
    version: m.version,
  })),
});

/** Cursor's `.cursor-plugin/marketplace.json`: each plugin by its folder under `pluginRoot`. */
export const cursorMarketplace = (market: Marketplace, listed: readonly Manifest[]): Readonly<Record<string, unknown>> => ({
  name: market.name,
  owner: { name: market.publisher },
  metadata: { description: market.description, pluginRoot: PLUGINS_DIR },
  plugins: listed.map((m) => ({ name: pluginNameOf(m.server), source: m.server })),
});
