/**
 * The site's pages as HTML, from what the repository already says: each
 * server's package.json `mcp` block (title, audience, maturity, tagline), the
 * audiences and maturities scripts/packaging.ts defines, the tool counts the
 * READMEs' tables give (which check-docs holds to the code), and the READMEs
 * themselves. No sentence here describes a server; the words around the
 * data are the site's own labels.
 */
import { AUDIENCE, AUDIENCES, MATURITIES, MATURITY, shipsOf, type Audience, type Manifest } from "../packaging.js";
import { relativeUrl } from "./links.js";
import { escapeHtml as esc, renderInline, renderReadme, sectionsOf, type LinkResolver } from "./markdown.js";

export type Server = {
  readonly manifest: Manifest;
  /** Its README, the documentation the site renders. */
  readonly readme: string;
  /** How many tools it has and the most they can do, in Markdown (scripts/readme.ts). */
  readonly reach: string;
};

export type Repository = {
  /** `https://github.com/<owner>/<repo>`. */
  readonly url: string;
  readonly name: string;
  readonly license: string;
  /** The root README. */
  readonly readme: string;
  /** The repository's GitHub topics, as the landing page's keywords. */
  readonly topics: readonly string[];
};

/** A page: its folder on the site ("" for the landing page, "servers/oblio/"), or a file ("404.html"), and its HTML. */
export type Page = { readonly path: string; readonly html: string };

/** How a page resolves a README's links: given the README's folder, the resolver for this page. */
export type Resolvers = (source: string, page: string) => LinkResolver;

/** The root README's sections the landing page shows, in order, by their headings. */
export const LANDING_SECTIONS = { band: "Quick start", grid: "What every server does the same way", pair: ["Status", "Documentation"] } as const;

const capitalised = (word: string): string => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

/** A page's folder for relative links: "servers/oblio/" is "servers/oblio"; a file sits at the root. */
const folderOf = (path: string): string => (path.endsWith("/") ? path.slice(0, -1) : path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

type Frame = {
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly body: string;
  readonly repository: Repository;
  readonly site: string;
  readonly current?: Audience;
  readonly keywords?: readonly string[];
  /** For a page served at any address (404.html): links from the site's root path instead of relative ones. */
  readonly absolute?: boolean;
};

const frame = (f: Frame): string => {
  const base = new URL(f.site).pathname;
  const to = (target: string): string => (f.absolute === true ? `${base}${target}` : relativeUrl(folderOf(f.path), target));
  const audiences = AUDIENCES.map(
    (a) => `<li><a href="${to(`${a}/`)}"${f.current === a ? ' aria-current="page"' : ""}>${esc(AUDIENCE[a].label)}</a></li>`,
  ).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(f.title)}</title>
<meta name="description" content="${esc(f.description)}">
${f.keywords === undefined ? "" : `<meta name="keywords" content="${esc(f.keywords.join(", "))}">\n`}<meta name="color-scheme" content="light dark">
<link rel="canonical" href="${esc(new URL(f.path, f.site).href)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(f.title)}">
<meta property="og:description" content="${esc(f.description)}">
<meta property="og:url" content="${esc(new URL(f.path, f.site).href)}">
<link rel="icon" href="${to("assets/mark.svg")}" type="image/svg+xml">
<link rel="preload" href="${to("assets/fonts/space-grotesk-latin-wght-normal.woff2")}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${to("assets/site.css")}">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="bar">
<div class="wrap">
<a class="mark" href="${to("")}"><img src="${to("assets/mark.svg")}" alt="" width="28" height="28">${esc(f.repository.name)}</a>
<nav aria-label="Site"><ul>${audiences}<li><a href="${esc(f.repository.url)}">GitHub</a></li></ul></nav>
</div>
</header>
<main id="main">
${f.body}
</main>
<footer class="foot">
<div class="wrap">
<span class="name">${esc(f.repository.name)}</span>
<ul>
<li><a href="${esc(`${f.repository.url}/blob/main/LICENSE`)}">${esc(f.repository.license)} License</a></li>
<li><a href="${esc(`${f.repository.url}/blob/main/CONTRIBUTING.md`)}">Contributing</a></li>
<li><a href="${esc(`${f.repository.url}/blob/main/SECURITY.md`)}">Security</a></li>
<li><a href="${esc(f.repository.url)}">Source on GitHub</a></li>
</ul>
</div>
</footer>
</body>
</html>
`;
};

const maturityChip = (m: Manifest): string => `<span class="maturity maturity-${m.maturity}">${capitalised(m.maturity)}</span>`;

/** A server as a row of a list: its icon, its title (the link), its maturity and reach, its tagline. */
const row = (s: Server, from: string): string => {
  const m = s.manifest;
  return `<li class="row">
<img src="${relativeUrl(from, `servers/${m.server}/icons/icon.svg`)}" alt="" width="32" height="32">
<h3><a href="${relativeUrl(from, `servers/${m.server}/`)}">${esc(m.title)}</a></h3>
<p class="meta">${maturityChip(m)} · ${renderInline(s.reach)}</p>
<p class="tagline">${esc(m.tagline)}</p>
</li>`;
};

const membersOf = (servers: readonly Server[], audience: Audience): readonly Server[] => servers.filter((s) => s.manifest.audience === audience);

const count = (n: number): string => `${n} ${n === 1 ? "server" : "servers"}`;

/** The root README's opening: its first bold sentence is the headline, the rest of the opening the lede. */
export const openingOf = (readme: string): { readonly headline: string; readonly lede: string } => {
  const begin = readme.indexOf("<!-- servers:begin -->");
  const opening = (begin === -1 ? readme : readme.slice(0, begin)).replace(/^# .*\n/, "").trim();
  const bold = /^\*\*(.+?)\*\*\s*/s.exec(opening);
  if (bold === null) throw new Error("README.md must open with a bold sentence after its title: the site's headline");
  return { headline: (bold[1] as string).replace(/\s+/g, " "), lede: opening.slice(bold[0].length) };
};

/** A section of the root README, rendered for the landing page, or a failure naming the heading it needs. */
const section = (readme: string, heading: string, resolve: LinkResolver): string => {
  const markdown = sectionsOf(readme).sections.get(heading);
  if (markdown === undefined) throw new Error(`README.md has no "## ${heading}" section, which the site's landing page shows (scripts/site/pages.ts)`);
  const { html, strays } = renderReadme(markdown, resolve);
  if (strays.length > 0) throw new Error(`README.md's "${heading}" has ${strays.join(", ")} outside code, which GitHub hides from its readers: put it in backticks`);
  return html;
};

/** A section as two columns: what it says before its first code block, then the code and the rest. */
const splitAtCode = (html: string): string => {
  const at = html.indexOf("<pre");
  return at === -1 ? `<div>${html}</div>` : `<div>${html.slice(0, at)}</div>\n<div>${html.slice(at)}</div>`;
};

export const landingPage = (servers: readonly Server[], repository: Repository, site: string, resolvers: Resolvers): Page => {
  const resolve = resolvers("", "");
  const { headline, lede } = openingOf(repository.readme);
  const [first, second] = AUDIENCES.filter((a) => AUDIENCE[a].ships);
  const audience = (a: Audience): string => {
    const members = membersOf(servers, a);
    return `<section class="audience" aria-labelledby="audience-${a}">
<header>
<p class="count">${count(members.length)}</p>
<h2 id="audience-${a}"><a href="${a}/">${esc(AUDIENCE[a].heading)}</a></h2>
<p>${esc(AUDIENCE[a].intro)}</p>
</header>
<ul class="rows">
${members.map((s) => row(s, "")).join("\n")}
</ul>
</section>`;
  };
  const rest = AUDIENCES.filter((a) => !AUDIENCE[a].ships && membersOf(servers, a).length > 0);
  const extras = rest
    .map(
      (a) => `<section class="extras wrap" aria-labelledby="audience-${a}">
<header>
<div><p class="count">${count(membersOf(servers, a).length)}</p><h2 id="audience-${a}"><a href="${a}/">${esc(AUDIENCE[a].heading)}</a></h2></div>
<p>${esc(AUDIENCE[a].intro)}</p>
</header>
<ul class="rows">
${membersOf(servers, a)
  .map((s) => row(s, ""))
  .join("\n")}
</ul>
</section>`,
    )
    .join("\n");
  const body = `<section class="hero wrap">
<h1>${renderInline(headline)}</h1>
<div class="lede">${renderReadme(lede, resolve).html}</div>
</section>
<div class="diptych wrap">
${[first, second].filter((a): a is Audience => a !== undefined).map(audience).join("\n")}
</div>
${extras}
<section class="band">
<div class="wrap">
${splitAtCode(section(repository.readme, LANDING_SECTIONS.band, resolve))}
</div>
</section>
<section class="prose-section grid-list wrap">
${section(repository.readme, LANDING_SECTIONS.grid, resolve)}
</section>
<div class="prose-section pair wrap">
${LANDING_SECTIONS.pair.map((heading) => `<section>\n${section(repository.readme, heading, resolve)}</section>`).join("\n")}
</div>`;
  return {
    path: "",
    html: frame({ path: "", title: `${repository.name}: ${headline}`, description: headline, body, repository, site, keywords: repository.topics }),
  };
};

export const audiencePage = (audience: Audience, servers: readonly Server[], repository: Repository, site: string): Page => {
  const path = `${audience}/`;
  const from = audience;
  const spec = AUDIENCE[audience];
  const members = membersOf(servers, audience);
  const legend = MATURITIES.filter((k) => members.some((s) => s.manifest.maturity === k))
    .map((k) => `<div><dt><span class="maturity maturity-${k}">${capitalised(k)}</span></dt><dd>${esc(capitalised(MATURITY[k]))}.</dd></div>`)
    .join("\n");
  const card = (s: Server): string => {
    const m = s.manifest;
    const colon = m.description.indexOf(": ");
    const details = colon === -1 ? "" : capitalised(m.description.slice(colon + 2));
    const pkg = !shipsOf(m)
      ? `<span>Not published: run it from a clone</span>`
      : m.private
        ? `<code>${esc(m.name)}</code><span>Not on npm yet: run it from a clone</span>`
        : `<code>npx -y ${esc(m.name)}</code>`;
    return `<li class="card">
<img src="${relativeUrl(from, `servers/${m.server}/icons/icon.svg`)}" alt="" width="40" height="40">
<h2><a href="${relativeUrl(from, `servers/${m.server}/`)}">${esc(m.title)}</a></h2>
<p class="meta">${maturityChip(m)}<span>${renderInline(s.reach)}</span></p>
<p class="tagline">${esc(m.tagline)}</p>
${details === "" ? "" : `<p class="details">${esc(details)}.</p>\n`}<p class="package">${pkg}</p>
</li>`;
  };
  const others = AUDIENCES.filter((a) => a !== audience && membersOf(servers, a).length > 0)
    .map((a) => `<li><a href="${relativeUrl(from, `${a}/`)}">${esc(AUDIENCE[a].heading)}</a></li>`)
    .join("");
  const body = `<nav class="crumbs wrap" aria-label="Breadcrumb"><ol><li><a href="${relativeUrl(from, "")}">${esc(repository.name)}</a></li><li><span aria-current="page">${esc(spec.heading)}</span></li></ol></nav>
<header class="page-head wrap">
<h1>${esc(spec.heading)}</h1>
<p class="lede">${esc(spec.intro)}</p>
</header>
<div class="wrap">
<dl class="legend">
${legend}
</dl>
<ul class="cards">
${members.map(card).join("\n")}
</ul>
<nav class="others" aria-label="Other servers">Also<ul>${others}</ul></nav>
</div>`;
  return { path, html: frame({ path, title: `${spec.heading} · ${repository.name}`, description: spec.intro, body, repository, site, current: audience }) };
};

export const serverPage = (s: Server, repository: Repository, site: string, resolvers: Resolvers): Page => {
  const m = s.manifest;
  const path = `servers/${m.server}/`;
  const from = `servers/${m.server}`;
  const { html, title, headings, strays } = renderReadme(s.readme, resolvers(m.repository.directory, from));
  if (title === undefined) throw new Error(`${m.repository.directory}/README.md has no title`);
  if (strays.length > 0) throw new Error(`${m.repository.directory}/README.md has ${strays.join(", ")} outside code, which GitHub hides from its readers: put it in backticks`);
  const toc = headings
    .filter((h) => h.depth === 2)
    .map((h) => `<li><a href="#${esc(h.id)}">${esc(h.text)}</a></li>`)
    .join("");
  const spec = AUDIENCE[m.audience];
  const body = `<nav class="crumbs wrap" aria-label="Breadcrumb"><ol><li><a href="${relativeUrl(from, "")}">${esc(repository.name)}</a></li><li><a href="${relativeUrl(from, `${m.audience}/`)}">${esc(spec.heading)}</a></li><li><span aria-current="page">${esc(m.title)}</span></li></ol></nav>
<header class="server-head wrap">
<img src="icons/icon.svg" alt="" width="56" height="56">
<div>
<h1>${esc(title)}</h1>
<ul class="facts">
<li>${maturityChip(m)}</li>
<li>${renderInline(s.reach)}</li>
<li><a href="${esc(`${m.repository.url}/tree/main/${m.repository.directory}`)}">Source on GitHub</a></li>
<li><a href="${esc(m.bugs)}">Report a problem</a></li>
</ul>
<p class="note">${capitalised(m.maturity)}: ${esc(MATURITY[m.maturity])}.</p>
</div>
</header>
<div class="doc wrap">
<nav class="toc" aria-label="On this page"><div><p>On this page</p><ol>${toc}</ol></div></nav>
<article class="readme">
${html}</article>
</div>`;
  return { path, html: frame({ path, title: `${m.title} · ${repository.name}`, description: m.tagline, body, repository, site, current: m.audience }) };
};

export const notFoundPage = (repository: Repository, site: string): Page => {
  const base = new URL(site).pathname;
  const body = `<header class="page-head wrap">
<h1>Nothing here</h1>
<p class="lede">This address is not a page of the site. Every server is listed on <a href="${base}">the front page</a>, by who it is for.</p>
</header>`;
  return { path: "404.html", html: frame({ path: "404.html", title: `Not found · ${repository.name}`, description: "This address is not a page of the site.", body, repository, site, absolute: true }) };
};
