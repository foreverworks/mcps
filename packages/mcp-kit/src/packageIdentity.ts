import { readFileSync } from "node:fs";

import type { Icon } from "@modelcontextprotocol/server";

/**
 * What a server says about itself at initialize beyond its name and version
 * (MCP serverInfo): a person's name for it, its home page and its icon, read
 * from its own package so a client shows what the registry and the README
 * show. The title is package.json's `mcp.title` and the page its `homepage`
 * (scripts/packaging.ts); the icon is `icons/icon-48.png` beside the package,
 * which scripts/icons.ts draws.
 *
 * `entryUrl` is the entry module's `import.meta.url`, one folder below the
 * package root from dist/ and from src/ alike (packageVersion.ts).
 */
export type PackageIdentity = {
  readonly title: string;
  readonly websiteUrl: string;
  readonly icons: readonly Icon[];
};

/**
 * A PNG as an MCP icon, inline. A data: URI rather than a link: the server is
 * local, so a client draws it without fetching anything from anyone. PNG
 * because clients must support it (SVG is a "should"); no `sizes`, as
 * GitHub's server does, for clients written before `sizes` became a list.
 */
const pngIcon = (url: URL): Icon => ({ src: `data:image/png;base64,${readFileSync(url).toString("base64")}`, mimeType: "image/png" });

export const packageIdentity = (entryUrl: string): PackageIdentity => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", entryUrl), "utf8")) as { readonly homepage?: unknown; readonly mcp?: { readonly title?: unknown } };
  const title = pkg.mcp?.title;
  if (typeof title !== "string" || title === "") throw new Error(`no mcp.title in the package.json beside ${entryUrl}`);
  if (typeof pkg.homepage !== "string" || pkg.homepage === "") throw new Error(`no homepage in the package.json beside ${entryUrl}`);
  return { title, websiteUrl: pkg.homepage, icons: [pngIcon(new URL("../icons/icon-48.png", entryUrl))] };
};

/** A product's icon (`icons/<product>-32.png`), for the tools of a server that serves several (serve's `products`). */
export const productIcons = (entryUrl: string, product: string): readonly Icon[] => [pngIcon(new URL(`../icons/${product}-32.png`, entryUrl))];
