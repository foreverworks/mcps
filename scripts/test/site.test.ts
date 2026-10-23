import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { topicsOf } from "../packaging.js";
import { checkSite, relativeUrl, resolveHref, type Layout } from "../site/links.js";
import { githubSlug, renderReadme, sectionsOf } from "../site/markdown.js";
import { openingOf } from "../site/pages.js";

const REPO = "https://github.com/example/mcps";

const KINDS: Readonly<Record<string, "file" | "dir">> = {
  "docs/configuration.md": "file",
  "packages/kit": "dir",
  "servers/alpha": "dir",
  "servers/beta": "dir",
  "servers/alpha/README.md": "file",
};

/** A repository with two servers, docs, and the icons the site copies. */
const LAYOUT: Layout = {
  repository: REPO,
  pages: new Map([
    ["", ""],
    ["servers/alpha", "servers/alpha/"],
    ["servers/beta", "servers/beta/"],
  ]),
  rootAnchors: new Map([["extras", "extras/"]]),
  copied: (path) => path === "servers/alpha/icons/icon.svg",
  kind: (path) => KINDS[path],
};

const fromAlpha = (href: string, kind: "link" | "image" = "link") => resolveHref(LAYOUT, "servers/alpha", "servers/alpha", href, kind);

describe("where a README's links lead on the site", () => {
  it("finds a page from a folder, a file or the root", () => {
    expect(relativeUrl("servers/alpha", "servers/beta/")).toBe("../beta/");
    expect(relativeUrl("servers/alpha", "")).toBe("../../");
    expect(relativeUrl("", "romania/")).toBe("romania/");
    expect(relativeUrl("", "")).toBe("./");
    expect(relativeUrl("servers/alpha", "servers/alpha/icons/icon.svg")).toBe("icons/icon.svg");
  });

  it("sends a link to another server's README to its page, and one to an audience to the audience's page", () => {
    expect(fromAlpha("../beta").url).toBe("../beta/");
    expect(fromAlpha("../beta/README.md#install").url).toBe("../beta/#install");
    expect(fromAlpha("../../README.md#extras").url).toBe("../../extras/");
    expect(resolveHref(LAYOUT, "", "", "#extras", "link").url).toBe("extras/");
    expect(fromAlpha("#configuration").url).toBe("#configuration");
  });

  it("sends the rest of the repository to GitHub, a folder as a tree, and keeps its own icons", () => {
    expect(fromAlpha("../../docs/configuration.md#transport").url).toBe(`${REPO}/blob/main/docs/configuration.md#transport`);
    expect(fromAlpha("../../packages/kit").url).toBe(`${REPO}/tree/main/packages/kit`);
    expect(fromAlpha("icons/icon.svg", "image").url).toBe("icons/icon.svg");
    expect(fromAlpha("https://example.com/x").url).toBe("https://example.com/x");
  });

  it("reports a link that leads nowhere, or out of the repository", () => {
    expect(fromAlpha("docs/missing.md").problem).toBe("docs/missing.md is not in the repository");
    expect(fromAlpha("../../../elsewhere").problem).toBe("../../../elsewhere leads out of the repository");
  });
});

describe("a README rendered for the site", () => {
  const readme = [
    '# <img src="icons/icon.svg" width="36" height="36" alt="Alpha icon"> Alpha MCP server',
    "",
    "Read [the configuration](../../docs/configuration.md).",
    "",
    "## Install",
    "",
    "[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install-0098FF)](https://vscode.dev/redirect/mcp/install?name=alpha) [![Install in Cursor](https://img.shields.io/badge/Cursor-Install-000000)](https://cursor.com/install-mcp?name=alpha)",
    "",
    "> [!NOTE]",
    "> `@example/mcp-alpha` is not on npm yet. [Run it from a clone](#from-a-clone).",
    "",
    "### From a clone",
    "",
    "```bash",
    'claude mcp add alpha -- node "$PWD/servers/alpha/dist/index.js"',
    "```",
    "",
    "## Tools",
    "",
    "| Tool | Access | What it does |",
    "|---|---|---|",
    "| `list_things` | read | Lists <things>. |",
    "",
    "## Install",
  ].join("\n");
  const rendered = renderReadme(readme, (href, kind) => fromAlpha(href, kind).url);

  it("takes the title out, and gives each heading GitHub's id, the second of a name a number", () => {
    expect(rendered.title).toBe("Alpha MCP server");
    expect(rendered.headings.map((h) => h.id)).toEqual(["install", "from-a-clone", "tools", "install-1"]);
    expect(rendered.html).toContain('<h3 id="from-a-clone">');
    expect(githubSlug("Getting the API key (`OBLIO_CONFIG`)")).toBe("getting-the-api-key-oblio_config");
    expect(githubSlug("Other servers for ANAF e-Factura")).toBe("other-servers-for-anaf-e-factura");
  });

  it("shows the install badges as links named by their alt text, and an alert as a note", () => {
    expect(rendered.html).toContain('<p class="installs"><a class="install" href="https://vscode.dev/redirect/mcp/install?name=alpha">Install in VS Code</a>');
    expect(rendered.html).not.toContain("img.shields.io");
    expect(rendered.html).toContain('<div class="alert alert-note" role="note"><p class="alert-title">Note</p><p><code>@example/mcp-alpha</code> is not on npm yet.');
  });

  it("resolves links, escapes code and wraps a table so it scrolls on its own", () => {
    expect(rendered.html).toContain(`<a href="${REPO}/blob/main/docs/configuration.md">the configuration</a>`);
    expect(rendered.html).toContain("&quot;$PWD/servers/alpha/dist/index.js&quot;");
    expect(rendered.html).toContain('<div class="table" tabindex="0"><table>');
  });

  it("names a tag GitHub would hide, such as a placeholder left out of backticks", () => {
    expect(rendered.strays).toEqual(["<things>"]);
    expect(renderReadme("Text with <br> and <sub>small</sub> and `<code>`.", (href) => href).strays).toEqual([]);
  });

  it("splits a README into its sections, ignoring headings inside code", () => {
    const { preamble, sections } = sectionsOf("# Title\n\nIntro.\n\n## One\n\n```md\n## Not a section\n```\n\n## Two\n\nText.");
    expect(preamble).toBe("# Title\n\nIntro.\n");
    expect([...sections.keys()]).toEqual(["One", "Two"]);
  });

  it("reads the root README's headline from its first bold sentence", () => {
    expect(openingOf("# mcps\n\n**Servers that do\nthings.** The rest.\n\nMore.\n\n<!-- servers:begin -->\nTable")).toEqual({ headline: "Servers that do things.", lede: "The rest.\n\nMore." });
    expect(() => openingOf("# mcps\n\nNo bold opening.")).toThrow(/bold sentence/);
  });
});

describe("the built site's own links", () => {
  const site = (files: Readonly<Record<string, string>>): string => {
    const root = mkdtempSync(join(tmpdir(), "site-"));
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return root;
  };
  const page = (body: string): string => `<!doctype html><html lang="en"><body>${body}</body></html>`;

  it("passes when every link leads to a page, a file or an id that is there", () => {
    const root = site({
      "index.html": page('<a href="servers/alpha/#tools">Alpha</a><img src="mark.svg" alt=""><a href="https://example.com">out</a>'),
      "servers/alpha/index.html": page('<h2 id="tools">Tools</h2><a href="../../">home</a><a href="/mcps/servers/alpha/">self</a>'),
      "mark.svg": "<svg/>",
      "assets/site.css": "@font-face { src: url(fonts/a.woff2) }",
      "assets/fonts/a.woff2": "",
    });
    expect(checkSite(root, "/mcps/")).toEqual([]);
  });

  it("names a missing page, a missing id, an image without alt text and a path outside the site", () => {
    const root = site({
      "index.html": page('<a href="servers/gamma/">Gamma</a><a href="#nowhere">here</a><img src="mark.svg"><a href="/other/">other</a>'),
      "mark.svg": "<svg/>",
    });
    expect(checkSite(root, "/mcps/")).toEqual([
      'index.html: an image without alt text: <img src="mark.svg">',
      "index.html: servers/gamma/ leads to nothing (servers/gamma/index.html)",
      "index.html: #nowhere: index.html has no #nowhere",
      "index.html: /other/ is outside the site's path /mcps/",
    ]);
  });
});

describe("the repository's GitHub topics", () => {
  it("are the base keywords, every published audience's, then each published server's first own keyword", () => {
    const servers = [
      { audience: "romania", keywords: ["mcp", "model-context-protocol", "mcp-server", "romania", "romanian", "e-factura", "anaf"] },
      { audience: "romania", keywords: ["mcp", "romania", "anaf", "spv"] },
      { audience: "general", keywords: ["mcp", "notion"] },
      { audience: "extras", keywords: ["mcp", "glovo"] },
    ] as const;
    expect(topicsOf(servers)).toEqual(["mcp", "model-context-protocol", "mcp-server", "romania", "romanian", "e-factura", "anaf", "notion"]);
  });
});
