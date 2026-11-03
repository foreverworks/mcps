/**
 * A plugin's README.md, which Claude's directory shows as the listing's
 * description and Cursor's marketplace shows beside it. Every sentence about
 * the server comes from its package.json `mcp` block, its npm description
 * and its README's tool tables (which check-docs holds to the code); the
 * rest is the same for every plugin and true of every one. The full
 * documentation stays the server's own README, which this links to.
 */
import { pluginNameOf, privacyUrl, SITE, type Input, type Manifest } from "../packaging.js";
import { accessOf } from "../readme.js";
import { pinnedCommand, type Marketplace } from "./manifests.js";

/** The npm description's details, after its head (`MCP server for X: ...`), as a sentence. */
const detailsOf = (description: string): string => {
  const colon = description.indexOf(": ");
  const details = colon === -1 ? description : description.slice(colon + 2);
  return `${details.charAt(0).toUpperCase()}${details.slice(1)}${details.endsWith(".") ? "" : "."}`;
};

/** `a`, `b` and `c`. */
const listed = (names: readonly string[]): string => {
  const quoted = names.map((n) => `\`${n}\``);
  return quoted.length < 2 ? quoted.join("") : `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1) ?? ""}`;
};

/**
 * What its tools can change, from the README's tables: the money tools by
 * name, and how a client confirms them (MCP_CONFIRM's default, `client`,
 * docs/security.md).
 */
const reachOf = (readme: string): string => {
  const access = [...accessOf(readme)];
  const count = `It has ${access.length} ${access.length === 1 ? "tool" : "tools"}`;
  const money = access.filter(([, a]) => a === "money").map(([tool]) => tool);
  if (money.length > 0) {
    return [
      `${count}, and ${money.length === 1 ? "one of them is" : `${money.length} of them are`} **money**, moving money or making or unmaking a legal or fiscal document: ${listed(money)}.`,
      "Claude Code asks you before every call to a money tool, in every permission mode, and Cursor asks before any tool that is not read-only unless you have allowed it.",
    ].join(" ");
  }
  if (access.some(([, a]) => a === "write")) return `${count}. Some of them change things in your account, and none moves money.`;
  return `${count}, and ${access.length === 1 ? "it" : "every one"} only reads.`;
};

const cell = (text: string): string => text.replace(/\|/g, "\\|");

const settingRow = (i: Input): string => `| ${cell(i.title)} (\`${i.name}\`) | ${i.required ? "yes" : "no"} | ${cell(i.description)} |`;

const settingsOf = (m: Manifest): readonly string[] =>
  m.inputs.length === 0
    ? ["It needs no settings."]
    : [
        `Claude Code asks for ${m.inputs.length === 1 ? "this setting" : "these settings"} when you enable the plugin; in Cursor, ${m.inputs.length === 1 ? "it is" : "they are"} set in the dashboard under Plugins, Configure. The Configuration section of [its documentation](${m.homepage}#configuration) says how to get each one.${m.inputs.every((i) => i.required) ? "" : " Leave an optional one empty and the server uses its default."}`,
        "",
        "| Setting | Required | What it is |",
        "|---|---|---|",
        ...m.inputs.map(settingRow),
      ];

/** The README of a listed server's plugin. `readme` is the server's own README. */
export const pluginReadme = (m: Manifest, readme: string, market: Marketplace): string => {
  const { publisher } = market;
  const plugin = pluginNameOf(m.server);
  const { command, args } = pinnedCommand(m);
  const node = m.node.replace(/^>=\s*/, "");
  const source = `${m.repository.url}/blob/main/${m.repository.directory}/README.md`;
  return [
    `# ${m.title} plugin from ${publisher}`,
    "",
    `${m.tagline} ${detailsOf(m.description)}`,
    "",
    `This plugin adds the ${m.title} MCP server from [${publisher}](${SITE}) to Claude Code and Cursor. [Its documentation](${m.homepage}) says what you need before you start, what each tool does, and what to do when something goes wrong.`,
    "",
    "## What it can change",
    "",
    reachOf(readme),
    "",
    "## Install",
    "",
    "In Claude Code 2.1.275 or newer:",
    "",
    "```",
    `/plugin install ${plugin} --marketplace ${market.slug}`,
    "```",
    "",
    `This adds the repository's marketplace, \`${market.name}\`, and installs the plugin from it. In an older Claude Code, run \`/plugin marketplace add ${market.slug}\`, then \`/plugin install ${plugin}@${market.name}\`.`,
    "",
    "## Settings",
    "",
    ...settingsOf(m),
    "",
    "## How it runs",
    "",
    `The plugin starts the server on your computer with \`${[command, ...args].join(" ")}\`: the published npm package, at the exact version this plugin was made for, on Node ${node} or newer.`,
    `The server sends requests only to the services its documentation names, from your computer${m.inputs.length === 0 ? "" : ", with the credentials you set above"}, so each service's own privacy policy covers what it receives.`,
    `${publisher} receives nothing: the server sends no telemetry and needs no account with us. The [privacy page](${privacyUrl}) says more.`,
    "",
    "## More",
    "",
    `- [Documentation](${m.homepage}): setup, every tool, troubleshooting and limitations.`,
    `- [The server's README and source on GitHub](${source}).`,
    `- [Report a problem](${m.bugs}).`,
    `- License: ${m.license}, in [LICENSE](LICENSE).`,
    "",
  ].join("\n");
};

/** The words a reader counts in a README, outside code blocks, as Claude's directory counts them (at least 40). */
export const wordsOf = (markdown: string): number => {
  let fenced = false;
  const prose = markdown.split("\n").filter((line) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    return !fenced;
  });
  return prose.join(" ").split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
};
