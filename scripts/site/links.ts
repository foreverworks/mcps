/**
 * Where a README's links lead on the site, and the check that every link the
 * built site holds leads somewhere. A README links to other READMEs (a page
 * here), to its icons (copied here), and to the rest of the repository (on
 * GitHub, at the same path); a path that is in none of those is a broken link
 * in the README, and the build fails on it.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";

/** What the resolver needs to know about the repository and the site built from it. */
export type Layout = {
  /** The repository on GitHub, `https://github.com/<owner>/<repo>`. */
  readonly repository: string;
  /** The site's page for each repository folder whose README it renders: "" (the root) to "", "servers/oblio" to "servers/oblio/". */
  readonly pages: ReadonlyMap<string, string>;
  /** Anchors of the root README that have a page of their own: "extras" to "extras/". */
  readonly rootAnchors: ReadonlyMap<string, string>;
  /** Whether the site holds a copy of a repository file at the same path (the icons). */
  readonly copied: (path: string) => boolean;
  /** Whether a repository path is a file or a folder, or neither. */
  readonly kind: (path: string) => "file" | "dir" | undefined;
};

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * The URL from a page (`from`, its folder on the site: "" for the landing
 * page, "servers/oblio" for a server's) to a path on the site, where a folder
 * ends in "/" and "" is the site's root.
 */
export const relativeUrl = (from: string, to: string): string => {
  const folder = to === "" || to.endsWith("/");
  const target = to.replace(/\/$/, "") || ".";
  const relative = posix.relative(from === "" ? "." : from, target);
  if (relative === "") return folder ? "./" : posix.basename(target);
  return folder ? `${relative}/` : relative;
};

/**
 * A README's href as the page that shows it links it. `source` is the
 * README's folder in the repository, `page` the page's folder on the site.
 * A link that leads nowhere is returned unchanged, with the problem.
 */
export const resolveHref = (layout: Layout, source: string, page: string, href: string, kind: "link" | "image"): { readonly url: string; readonly problem?: string } => {
  if (SCHEME.test(href)) return { url: href };
  if (href.startsWith("#")) {
    const own = source === "" ? layout.rootAnchors.get(href.slice(1)) : undefined;
    return { url: own === undefined ? href : relativeUrl(page, own) };
  }
  const at = href.indexOf("#");
  const path = at === -1 ? href : href.slice(0, at);
  const hash = at === -1 ? "" : href.slice(at + 1);
  const joined = posix.normalize(posix.join(source === "" ? "." : source, decodeURI(path))).replace(/\/$/, "");
  if (joined.startsWith("..")) return { url: href, problem: `${href} leads out of the repository` };
  const repoPath = joined === "." ? "" : joined;
  const readme = repoPath === "README.md" || repoPath.endsWith("/README.md");
  const folder = readme ? posix.dirname(repoPath).replace(/^\.$/, "") : repoPath;
  const pageOf = layout.pages.get(folder);
  if (pageOf !== undefined && (readme || layout.kind(repoPath) === "dir" || repoPath === "")) {
    const own = folder === "" ? layout.rootAnchors.get(hash) : undefined;
    if (own !== undefined) return { url: relativeUrl(page, own) };
    return { url: `${relativeUrl(page, pageOf)}${hash === "" ? "" : `#${hash}`}` };
  }
  if (layout.copied(repoPath)) return { url: `${relativeUrl(page, repoPath)}${hash === "" ? "" : `#${hash}`}` };
  const found = layout.kind(repoPath);
  if (found === undefined) return { url: href, problem: `${href} is not in the repository` };
  const where = kind === "image" ? `${layout.repository.replace("https://github.com/", "https://raw.githubusercontent.com/")}/main` : `${layout.repository}/${found === "dir" ? "tree" : "blob"}/main`;
  return { url: `${where}/${encodeURI(repoPath)}${hash === "" ? "" : `#${hash}`}` };
};

/** Every file under a folder, as paths relative to it. */
const filesUnder = (root: string, dir = ""): readonly string[] =>
  readdirSync(join(root, dir)).flatMap((name) => {
    const path = dir === "" ? name : `${dir}/${name}`;
    return statSync(join(root, path)).isDirectory() ? filesUnder(root, path) : [path];
  });

/** The ids a page gives its elements. */
const idsOf = (html: string): ReadonlySet<string> => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1] as string));

/** What a page or stylesheet links to: href and src attributes, and CSS url()s. */
const referencesOf = (text: string): readonly string[] => [
  ...[...text.matchAll(/\s(?:href|src)="([^"]*)"/g)].map((m) => m[1] as string),
  ...[...text.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1] as string),
];

const unescape = (url: string): string => url.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/**
 * Every problem with the built site's own links: a link to a file that is
 * not there, to a fragment its page does not have, or out of the site; and
 * an image without alt text. A link from the site's root path (`base`, as a
 * page served at any address uses) is read from the site's root. Links to
 * other sites are not followed (the build runs offline); READMEs' links into
 * the repository were checked as they were resolved.
 */
export const checkSite = (root: string, base: string): readonly string[] => {
  const files = filesUnder(root);
  const pages = new Map(files.filter((f) => f.endsWith(".html")).map((f) => [f, readFileSync(join(root, f), "utf8")] as const));
  const ids = new Map([...pages].map(([file, html]) => [file, idsOf(html)] as const));
  const problems: string[] = [];
  for (const file of files.filter((f) => f.endsWith(".html") || f.endsWith(".css"))) {
    const text = pages.get(file) ?? readFileSync(join(root, file), "utf8");
    if (file.endsWith(".html")) {
      for (const img of text.match(/<img\b[^>]*>/g) ?? []) if (!/\salt="/.test(img)) problems.push(`${file}: an image without alt text: ${img.slice(0, 80)}`);
      if (!/<html lang="[a-z]+">/.test(text)) problems.push(`${file}: no <html lang>`);
      const duplicate = [...text.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1] as string).find((id, i, all) => all.indexOf(id) !== i);
      if (duplicate !== undefined) problems.push(`${file}: the id "${duplicate}" is given twice`);
    }
    for (const raw of referencesOf(text)) {
      const reference = unescape(raw);
      if (SCHEME.test(reference) || reference.startsWith("//")) continue;
      if (reference.startsWith("/") && !reference.startsWith(base)) {
        problems.push(`${file}: ${reference} is outside the site's path ${base}`);
        continue;
      }
      const at = reference.indexOf("#");
      const path = (at === -1 ? reference : reference.slice(0, at)).split("?")[0] ?? "";
      const fragment = at === -1 ? "" : decodeURIComponent(reference.slice(at + 1));
      const from = path.startsWith("/") ? "." : posix.dirname(file);
      const local = path.startsWith("/") ? path.slice(base.length) || "./" : path;
      const joined = path === "" ? file : posix.normalize(posix.join(from, decodeURI(local)));
      if (joined.startsWith("..")) {
        problems.push(`${file}: ${reference} leads out of the site`);
        continue;
      }
      const target = path === "" ? file : local.endsWith("/") || (existsSync(join(root, joined)) && statSync(join(root, joined)).isDirectory()) ? posix.join(joined, "index.html") : joined;
      if (!existsSync(join(root, target))) problems.push(`${file}: ${reference} leads to nothing (${target})`);
      else if (fragment !== "" && target.endsWith(".html") && !ids.get(target)?.has(fragment)) problems.push(`${file}: ${reference}: ${target} has no #${fragment}`);
    }
  }
  return problems;
};
