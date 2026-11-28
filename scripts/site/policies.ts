/**
 * The site's pages about the hosted servers and about data: privacy, the terms
 * the hosted servers are used under, and where to get help. Each sentence is a
 * fact of the code or of how the service is run; change a sentence when either
 * changes. Which servers are hosted, and where, is each package.json's
 * `mcp.remote`, never typed here; what each one asks of the service behind it
 * is `UPSTREAM`, and a hosted server without an entry stops the build, so no
 * server is hosted without the privacy page saying where its questions go.
 */
import { HOSTED_ORIGIN, PRIVACY_PATH, SUPPORT_PATH, TERMS_PATH, type Manifest } from "../packaging.js";
import { relativeUrl } from "./links.js";
import { escapeHtml as esc } from "./markdown.js";
import { frame, type Page, type Repository } from "./pages.js";

/** A paragraph, or a list of short items. Already HTML: what it quotes from outside is escaped where it is written. */
type Block = string | { readonly list: readonly string[] };

type Section = readonly [heading: string, blocks: readonly Block[]];

/** What a hosted server sends to which service, in words a person follows. */
const UPSTREAM: Readonly<Record<string, string>> = {
  bnr: "the National Bank of Romania (curs.bnr.ro) gets the currency, date and year you ask a rate for",
  ecb: "the European Central Bank (www.ecb.europa.eu) gets the currency, date and window you ask a rate for",
  trademarks: "the US Patent and Trademark Office's trademark search (tmsearch.uspto.gov) gets the name, classes and words you search for, and the number of a mark you open",
  "anaf-efactura": "ANAF, Romania's tax authority (webservicesp.anaf.ro), gets the company identifiers (CIFs) you look up and the invoice XML you send to check or turn into a PDF",
};

const hostedAt = (m: Manifest): string => m.remote ?? "";

const list = (items: readonly string[]): Block => ({ list: items });

const blockHtml = (block: Block): string => (typeof block === "string" ? `<p>${block}</p>` : `<ul>\n${block.list.map((item) => `<li>${item}</li>`).join("\n")}\n</ul>`);

/** A page of plain sections under a title, in the site's frame, with the nav marking it as the current one. */
const textPage = (path: string, title: string, lede: string, sections: readonly Section[], repository: Repository, site: string): Page => {
  const body = `<nav class="crumbs wrap" aria-label="Breadcrumb"><ol><li><a href="${relativeUrl(path.slice(0, -1), "")}">${esc(repository.name)}</a></li><li><span aria-current="page">${esc(title)}</span></li></ol></nav>
<header class="page-head wrap">
<h1>${esc(title)}</h1>
<p class="lede">${lede}</p>
</header>
<div class="wrap">
<article class="readme">
${sections.map(([heading, blocks]) => `<h2>${heading}</h2>\n${blocks.map(blockHtml).join("\n")}`).join("\n")}
</article>
</div>`;
  return { path, html: frame({ path, title: `${title} · ${repository.name}`, description: lede.replace(/<[^>]+>/g, ""), body, repository, site, here: path }) };
};

const issues = (repository: Repository): string => `<a href="${esc(`${repository.url}/issues`)}">an issue on GitHub</a>`;
const security = (repository: Repository): string => `<a href="${esc(`${repository.url}/blob/main/SECURITY.md`)}">SECURITY.md</a>`;

/** The hosted servers, each with its address and what it asks of its service; refuses a hosted server the page cannot describe. */
const hostedOf = (manifests: readonly Manifest[]): readonly (Manifest & { readonly asks: string })[] =>
  manifests
    .filter((m) => m.remote !== undefined)
    .map((m) => {
      const asks = UPSTREAM[m.server];
      if (asks === undefined) throw new Error(`${m.server} is hosted (mcp.remote) and scripts/site/policies.ts does not say where its questions go: add it to UPSTREAM`);
      if (!hostedAt(m).startsWith(`${HOSTED_ORIGIN}/`)) throw new Error(`${m.server}'s mcp.remote is not under ${HOSTED_ORIGIN}, which the policy pages name`);
      return { ...m, asks };
    });

/**
 * What the servers, and the plugins made from them, do with a person's data:
 * the page a plugin listing links to as its privacy policy
 * (scripts/plugins.ts). A server you run yourself runs where you start it and
 * sends nothing to us. The hosted servers do receive your calls, and the page
 * says what they do with them, from what the kit does per request in a public
 * server (packages/mcp-kit, serve/public.ts and serve/guard.ts): no address is
 * logged, a caller is counted by address in memory only, and a log line holds
 * the tool and its outcome, never an argument or a result.
 */
export const privacyPage = (repository: Repository, site: string, publisher: string, manifests: readonly Manifest[]): Page => {
  const hosted = hostedOf(manifests);
  const sections: readonly Section[] = [
    [
      "Two ways to use the servers",
      [
        `You can run a server yourself, on your own computer or on a machine you choose, or connect to one of the servers ${esc(publisher)} hosts for anyone. The first sends us nothing. The second sends us your calls, and the sections below say what happens to them.`,
      ],
    ],
    [
      "When you run a server yourself",
      [
        `Each server is a program that your AI client starts on your own computer, from its npm package, its desktop bundle or a clone of this repository, or that you run as a service on a machine you choose. ${esc(publisher)} runs no server that your data passes through then, and the servers and their plugins send nothing to ${esc(publisher)}: no telemetry, no analytics, no crash reports and no usage counts. There is no account to create with us.`,
        "A server sends requests only to the services its documentation names, with the credentials you give it. It reads those credentials from files and settings on the computer it runs on, and keeps what it saves there too: the grants you give it, its caches and the files it downloads. What a service receives is covered by that service's own privacy policy.",
      ],
    ],
    ...(hosted.length === 0
      ? []
      : ([
          [
            "The hosted servers",
            [
              `${esc(publisher)} hosts ${hosted.length === 1 ? "one server" : `${hosted.length} servers`} for anyone to use with no account, no sign-in and no key, each at an address of its own:`,
              list(hosted.map((m) => `${esc(m.title)}: <code>${esc(hostedAt(m))}</code>`)),
              "They are the same code as the servers in this repository, started with only the tools that need no credential of anyone's: they read public sources and write nothing, and none of them can reach an account.",
            ],
          ],
          [
            "What a hosted call sends where",
            [
              "Your AI app sends each call to the server. The server asks the public source it reads, and answers your app with what it found. What each one asks of its source:",
              list(hosted.map((m) => `${esc(m.title)}: ${esc(m.asks)}.`)),
              "The source sees the server's address, never yours, and nothing about you beyond what you typed into the call. Each source has its own privacy policy and terms for what it receives. Do not put in a call what you would not give to that source.",
              "The server keeps no copy of what you send or of what comes back. An invoice you build or turn into a PDF is returned to your app inside the answer and is not stored on the server.",
            ],
          ],
          [
            "Cloudflare",
            [
              `Our hosted deployment sits behind <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare</a>, which protects and delivers the service, so your requests pass through it. Cloudflare sees the connection, your address included, and its own privacy policy covers what it does with that. Our deployment is set up to read your address from the header Cloudflare adds (<code>cf-connecting-ip</code>) for the rate limit below, and for nothing else.`,
            ],
          ],
          [
            "Your address, and the rate limit",
            [
              "To keep one caller from using up a service everyone shares, the server counts the calls from each address (an IPv6 address counts as its whole /64 network, which one machine usually holds). The counts live in the server's memory only, as an address and a number, and are never written to a disk or a log. A count stops mattering a few seconds after a caller's last call, but the server drops it only when a later call from anyone arrives after that, so on a quiet service an address can stay in memory for longer. All the counts are gone when the service restarts.",
            ],
          ],
          [
            "What is logged",
            [
              "For each call the server writes one line to its log: which server and tool, that the caller was public, whether the call worked or how it failed, and how long it took. It does not log your address, what you asked, the values you typed (a name, a CIF, an invoice) or what came back. When something breaks it also logs the technical error, which names the failure and not your question.",
              "Our hosted deployment writes this log to the system journal of the machine that runs it, and it is not copied to another service or shared. The journal is there so we can see that the service works and where it fails, not who you are. If you run a server yourself, where its log goes is up to you.",
            ],
          ],
          [
            "What we do not do",
            [
              "There are no accounts and no cookies, and no tracking of any kind. We do not sell what passes through the service, we do not share it, and we do not use it to train a model or to build a profile of anyone. What your AI app does with the answers is up to that app and its own policy.",
            ],
          ],
        ] as const satisfies readonly Section[])),
    [
      "Installing a server",
      [
        "When you install a server with npx or as a plugin, your computer downloads its package from the npm registry, and npm's privacy policy covers that download; a desktop bundle comes from this repository's releases on GitHub. A plugin directory or marketplace you install it from has its own policy too.",
      ],
    ],
    [
      "This site",
      [
        "This site is served by GitHub Pages, whose privacy statement covers the requests your browser makes to it. The site sets no cookies of its own, runs no scripts or analytics, and loads nothing from other sites: its fonts and images are its own files.",
      ],
    ],
    [
      "Questions",
      [`Ask in ${issues(repository)}. Report a security problem privately, as ${security(repository)} describes. The <a href="${relativeUrl(PRIVACY_PATH.slice(0, -1), SUPPORT_PATH)}">support page</a> says more about getting help.`],
    ],
  ];
  return textPage(PRIVACY_PATH, "Privacy", `What the servers in ${esc(repository.name)}, and the plugins made from them, do with your data, and what the hosted servers do with your calls.`, sections, repository, site);
};

/** The terms the hosted servers are used under: free, as they are, with limits and a few plain rules. */
export const termsPage = (repository: Repository, site: string, publisher: string, manifests: readonly Manifest[]): Page => {
  const hosted = hostedOf(manifests);
  const sections: readonly Section[] = [
    [
      "What these terms cover",
      [
        `${hosted.length === 0 ? "The hosted servers" : `The hosted servers (${hosted.map((m) => esc(m.title)).join(", ")})`} are run by ${esc(publisher)} for anyone to use from an AI app or a script, at <code>${esc(HOSTED_ORIGIN)}</code>. By using them you agree to what is on this page. The code itself is open source under the ${esc(repository.license)} license, and running your own copy is never covered by these terms: that is covered by the license.`,
      ],
    ],
    [
      "Free, and as it is",
      [
        "The hosted servers are free. They come as they are, with no promise that they are right, complete, fast or always there, and with no warranty of any kind, to the extent the law allows. What they answer comes from public sources we do not control, and a source can be wrong, late or down. Check anything that matters, such as a filing, an invoice, a payment or a trademark decision, against the source itself.",
      ],
    ],
    [
      "They are not advice",
      [
        "A trademark search is not legal advice and does not tell you that a name is free to use. An exchange rate is the central bank's published reference, not an offer from a bank. A validation answer is the tax authority's verdict on a document, not tax advice. We are not liable for what you decide using them.",
      ],
    ],
    [
      "Fair use and limits",
      [
        "The service counts calls per address and refuses calls over its limit with an HTTP 429 (too many requests) and a Retry-After header saying how many seconds to wait. The limits are generous for a person working with an assistant and are not for bulk collection, and they can change without notice. Please wait as the answer says and do not work around the limit.",
      ],
    ],
    [
      "What not to do",
      [
        "Use the servers lawfully, and leave the service as you found it. In particular do not:",
        list([
          "try to break, overload, probe or get around the service, its limits or its protections;",
          "use it to send the sources more calls than you could make by hand, or to harm them;",
          "send data you have no right to send to the source it goes to;",
          "present answers as official or as coming from the source's own service.",
        ]),
        "We may refuse a caller that does, with no notice.",
      ],
    ],
    [
      "The sources' own terms",
      [
        "Every answer comes from a public source (the National Bank of Romania, the European Central Bank, ANAF and the US Patent and Trademark Office), and each source's own terms apply to its data and to how you may use it. For example, the European Central Bank publishes its rates for information purposes only. The data is theirs, not ours.",
      ],
    ],
    [
      "Privacy",
      [`What the hosted servers do with your calls is on the <a href="${relativeUrl(TERMS_PATH.slice(0, -1), PRIVACY_PATH)}">privacy page</a>.`],
    ],
    [
      "Changes, and stopping",
      [
        `We may change or stop the hosted servers, or these terms, at any time, with or without notice: a server can be removed, a tool can change, a limit can tighten. The latest terms are always on this page. If you need something that must stay, run your own copy: the code is in <a href="${esc(repository.url)}">the repository</a>.`,
      ],
    ],
    [
      "Questions",
      [`Ask in ${issues(repository)}; the <a href="${relativeUrl(TERMS_PATH.slice(0, -1), SUPPORT_PATH)}">support page</a> says what to include.`],
    ],
  ];
  return textPage(TERMS_PATH, "Terms", "The terms the hosted servers are used under: free, as they are, with a few plain rules.", sections, repository, site);
};

/** Where to get help, for the hosted servers and for running one yourself. */
export const supportPage = (repository: Repository, site: string, manifests: readonly Manifest[]): Page => {
  const hosted = hostedOf(manifests);
  const sections: readonly Section[] = [
    [
      "Something does not work",
      [
        `Open ${issues(repository)}. It is the one place we read, and anyone can see the answer. There is no support email or phone line.`,
        "Say which server (for a hosted one, its address), which tool, roughly when it happened with your time zone, and what you asked and what you got, with the error text as it was. Use invented values or leave out anything private: an issue is public, so do not paste an invoice, a CIF you would rather keep to yourself or a key.",
      ],
    ],
    ...(hosted.length === 0
      ? []
      : ([
          [
            "The hosted servers",
            [
              "Their addresses are:",
              list(hosted.map((m) => `${esc(m.title)}: <code>${esc(hostedAt(m))}</code>`)),
              "Add one in your AI app as a custom connector, with no sign-in: in Claude, Settings, Connectors, Add custom connector, and paste the address. Each server's page on this site says which tools it has.",
              "If a call answers \"too many requests\" (429), wait the seconds the answer gives and try again. It is free and run on a best-effort basis: we read issues as time allows, and cannot promise a time to answer or to fix.",
            ],
          ],
        ] as const satisfies readonly Section[])),
    [
      "Running a server yourself",
      [
        "Each server's page on this site has a troubleshooting section keyed to what you see. Start with the server's <code>health</code> tool, which says what works and what does not.",
      ],
    ],
    [
      "A security problem",
      [`Do not open a public issue. Report it privately, as ${security(repository)} describes.`],
    ],
    [
      "Terms and privacy",
      [
        `The <a href="${relativeUrl(SUPPORT_PATH.slice(0, -1), TERMS_PATH)}">terms</a> and the <a href="${relativeUrl(SUPPORT_PATH.slice(0, -1), PRIVACY_PATH)}">privacy page</a> cover the hosted servers.`,
      ],
    ],
  ];
  return textPage(SUPPORT_PATH, "Support", "How to report a problem and get help, with the hosted servers or your own.", sections, repository, site);
};
