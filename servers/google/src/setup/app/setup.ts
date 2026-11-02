import type { ConsentProduct } from "../../consent/domain/consent.js";
import type { Toolset } from "../../mcp/policy.js";
import { checkClientFile } from "../domain/clientFile.js";
import {
  APP_DOMAIN,
  apisOf,
  consentProductsOf,
  consentSteps,
  consoleLinks,
  installLines,
  newProjectId,
  optionalScopesOf,
  PACKAGE,
  type Parsed,
  parseLabels,
  parseToolsets,
  PROJECT_CREATE_URL,
  PROJECT_ID,
  scopesOf,
  type Step,
} from "../domain/plan.js";
import type { Ports, Terminal } from "./ports.js";

/**
 * `mcp-google setup`: from nothing to a working server, with a person at a
 * terminal. It asks which products and accounts, gets a Google Cloud project
 * and its APIs (through gcloud when it is signed in, else one console link),
 * walks the person through the Google Auth Platform pages no API can fill in,
 * picks up the client file they download, runs each consent through a
 * loopback redirect, and prints the line that adds the server to a client.
 *
 * Run again, it keeps what exists: the client, and any grant the person does
 * not ask to replace. It returns the process's exit code.
 */
export const runSetup = async (p: Ports): Promise<number> => {
  const t = p.terminal;
  t.say(
    lines(
      "Google Workspace MCP server: setup",
      "",
      "This connects your Google accounts to the server. It takes about ten minutes:",
      "a few questions here, a few clicks in Google Cloud's console (Google lets no",
      "program make them), and one approval in your browser per product and account.",
      `Everything is saved in ${p.stateDir}`,
      "and stays on this computer. Press Ctrl+C at any time to stop.",
    ),
  );

  heading(t, "Products and accounts");
  t.say("Which products should your assistant reach? Choose from:");
  t.say("  gmail, calendar, drive, docs, sheets, slides, collaboration, tasks, contacts, meet");
  t.say("(collaboration is comments, sharing and revisions on Drive files). Separate them with commas.");
  const toolsets = await askUntil(t, "Products", "all", parseToolsets);
  const products = consentProductsOf(toolsets);
  t.say("");
  t.say("Give each Google account a short label, such as personal or work: your assistant");
  t.say("names accounts by these. Separate several with commas.");
  const labels = await askUntil(t, "Account labels", "personal", parseLabels);
  const driveAccount =
    products.includes("drive") && labels.length > 1
      ? await askUntil(t, "Drive reaches one account's Drive. Which account", labels[0], (a) =>
          labels.includes(a) ? { ok: a } : { problem: `choose one of ${labels.join(", ")}` },
        )
      : labels[0];

  const client = await p.existingClient();
  const keep =
    client !== undefined &&
    (client.from === "GOOGLE_OAUTH_CLIENT_FILE" || yes(await t.ask(`An OAuth client is already set up (${client.path}). Keep using it? [Y/n]`, "y")));
  if (client && keep) {
    t.say(`Using the OAuth client in ${client.path}${client.from === "GOOGLE_OAUTH_CLIENT_FILE" ? " (GOOGLE_OAUTH_CLIENT_FILE)" : ""}.`);
    if (yes(await t.ask("Are you adding products it was not set up for? [y/N]", "n"))) {
      const projectId = client.projectId ?? (await askUntil(t, "Its Google Cloud project ID", undefined, projectIdOf));
      await enableApis(p, projectId, products);
      await declareScopes(p, projectId, products);
    }
  } else {
    const projectId = await project(p, products);
    await authPlatform(p, projectId, products);
    await fetchClient(p);
  }

  const done = await approvals(p, consentSteps(products, labels, driveAccount));
  finish(p, toolsets, done);
  return done.failed > 0 ? 1 : 0;
};

const lines = (...text: readonly string[]): string => text.join("\n");

const heading = (t: Terminal, title: string): void => t.say(`\n== ${title} ==\n`);

const yes = (answer: string): boolean => /^y(es)?$/i.test(answer.trim());

/** Asks until the answer parses, saying why each one that did not. */
const askUntil = async <T>(t: Terminal, question: string, fallback: string | undefined, parse: (answer: string) => Parsed<T>): Promise<T> => {
  for (;;) {
    const parsed = parse(await t.ask(question, fallback));
    if ("ok" in parsed) return parsed.ok;
    t.say(`  ${parsed.problem}.`);
  }
};

const projectIdOf = (answer: string): Parsed<string> =>
  PROJECT_ID.test(answer) ? { ok: answer } : { problem: "a project ID is 6 to 30 lowercase letters, digits and hyphens, starting with a letter" };

const opened = async (p: Ports, url: string): Promise<void> => {
  const ok = await p.open(url);
  p.terminal.say(ok ? `  Opened in your browser: ${url}` : `  Open this in your browser: ${url}`);
};

const whenDone = (t: Terminal): Promise<string> => t.ask("Press Enter when you have done this");

/** A project with the products' APIs enabled: made by gcloud when the person wants it, else in the console. Its ID. */
const project = async (p: Ports, products: readonly ConsentProduct[]): Promise<string> => {
  const t = p.terminal;
  heading(t, "A Google Cloud project");
  t.say("The server reaches Google through an OAuth client of your own, which lives in a");
  t.say("Google Cloud project. A project costs nothing for this; no billing account is needed.");
  const gcloud = await p.gcloud();
  if (gcloud && yes(await t.ask(`gcloud is signed in as ${gcloud.account}. Create a new project with it and enable the APIs there? [Y/n]`, "y"))) {
    const projectId = await askUntil(t, "Project ID", newProjectId(), projectIdOf);
    try {
      t.say(`  Creating ${projectId}...`);
      await gcloud.createProject(projectId, "MCP Google");
      t.say(`  Enabling ${apisOf(products).join(", ")}...`);
      await gcloud.enableApis(projectId, apisOf(products));
      t.say("  Done.");
      return projectId;
    } catch (thrown) {
      t.say(`  gcloud failed: ${p.describe(thrown)}`);
      t.say("  Let's do it in the console instead.");
    }
  }
  t.say("");
  t.say("Create a project in the console. Any name will do, such as MCP Google. Once it is");
  t.say("created, copy its project ID: the console shows it under the name as you create it,");
  t.say("and on the project's dashboard.");
  await opened(p, PROJECT_CREATE_URL);
  const projectId = await askUntil(t, "Project ID", undefined, projectIdOf);
  await enableApis(p, projectId, products);
  return projectId;
};

const enableApis = async (p: Ports, projectId: string, products: readonly ConsentProduct[]): Promise<void> => {
  const t = p.terminal;
  const apis = apisOf(products);
  heading(t, "The APIs");
  t.say(`Your products need ${apis.length === 1 ? "one API" : `${apis.length} APIs`} enabled in ${projectId}: ${apis.join(", ")}.`);
  t.say(`This link asks for all of them at once. Check that the project shown is ${projectId},`);
  t.say("click Next, then Enable.");
  await opened(p, consoleLinks(projectId, apis).enableApis);
  await whenDone(t);
};

const declareScopes = async (p: Ports, projectId: string, products: readonly ConsentProduct[]): Promise<void> => {
  const t = p.terminal;
  const optional = optionalScopesOf(products);
  t.say("");
  t.say("Data Access: the permissions your app asks for. Click Add or remove scopes. At the");
  t.say("bottom of the panel, under Manually add scopes, paste these lines, click Add to table,");
  t.say("then Update, then Save at the bottom of the page:");
  t.say("");
  for (const scope of scopesOf(products)) t.say(`  ${scope}`);
  t.say("");
  if (optional.length > 0) t.say(`(${optional.join(", ")} only works for a Google Workspace account; the rest of setup works without it.)`);
  await opened(p, consoleLinks(projectId, []).dataAccess);
  await whenDone(t);
};

/** The four Google Auth Platform pages, in order: no API fills them in. */
const authPlatform = async (p: Ports, projectId: string, products: readonly ConsentProduct[]): Promise<void> => {
  const t = p.terminal;
  const links = consoleLinks(projectId, []);
  heading(t, "Google Auth Platform");
  t.say("Four short pages tell Google what your app is and who may use it. Google allows no");
  t.say("program to fill them in, so this part is yours; setup opens each page.");
  t.say("");
  t.say("Branding. On a new project the page says Google Auth Platform is not configured yet:");
  t.say("click Get started, then");
  t.say("  App information: an app name only you will see, such as MCP Google, and your");
  t.say("    address as the support email;");
  t.say("  Audience: Internal if every account you will connect belongs to the Google Workspace");
  t.say("    organisation that owns this project, otherwise External;");
  t.say("  Contact information: your address;");
  t.say("  Finish: agree to Google's policy, then Create.");
  t.say("If you chose External, open Branding again (the same link) and fill in App domain,");
  t.say("which Google requires before it lets an External app be published:");
  t.say(`  Application home page: ${APP_DOMAIN.homePage}`);
  t.say(`  Application privacy policy link: ${APP_DOMAIN.privacyPolicy}`);
  t.say(`  Authorized domains: Add domain, ${APP_DOMAIN.domain}`);
  t.say("then Save at the bottom. (Pages of your own work too, on a domain you add there.)");
  await opened(p, links.branding);
  await whenDone(t);

  t.say("");
  t.say("Audience. If you chose External, click Publish app, then Confirm. An app left in");
  t.say("Testing stops working after seven days, because Google expires its grants weekly.");
  t.say("Google's dialog says the app becomes available to any Google account: only someone");
  t.say("holding your client file can ask for an approval, and it stays on this computer. Google");
  t.say("may say the app needs verification; your own accounts do not need it. If Publish app");
  t.say("is greyed out, App domain on the Branding page is not saved yet. If you chose Internal,");
  t.say("there is nothing to do on this page.");
  await opened(p, links.audience);
  await whenDone(t);

  await declareScopes(p, projectId, products);

  t.say("");
  t.say("Clients. Choose Desktop app as the application type, give it any name, and click");
  t.say("Create. In the dialog that follows, click Download JSON: Google shows the client's");
  t.say("secret only in that dialog, so if you close it first, create another client.");
  await opened(p, links.createClient);
};

/** The client file the person downloaded: found in Downloads or at a path they type, checked, and kept 0600. */
const fetchClient = async (p: Ports): Promise<void> => {
  const t = p.terminal;
  heading(t, "The client file");
  const since = p.now() - 10 * 60 * 1000;
  t.say(`Waiting for the file you downloaded (client_secret_...json) to appear in ${p.downloadsDir}.`);
  t.say("If your browser saved it somewhere else, type its path and press Enter.");
  for (;;) {
    const got = await t.askOrWait("Path", p.watchForClient(p.downloadsDir, since));
    const path = "found" in got ? got.found : got.typed;
    if (!path) continue;
    const raw = await p.readJson(path);
    const checked = raw === undefined ? { problem: "it cannot be read as JSON" } : checkClientFile(raw);
    if ("problem" in checked) {
      t.say(`  ${path}: ${checked.problem}.`);
      continue;
    }
    const kept = await p.keepClient(path);
    t.say(`  Found it${checked.ok.projectId ? ` (project ${checked.ok.projectId})` : ""}. Moved to ${kept}, readable only by you.`);
    return;
  }
};

type Outcome = { readonly made: readonly (Step & { readonly address: string })[]; readonly failed: number };

/** Each consent through a loopback redirect, or a pasted address where the browser cannot reach this computer. */
const approvals = async (p: Ports, steps: readonly Step[]): Promise<Outcome> => {
  const t = p.terminal;
  heading(t, "Approvals");
  const wanted: Step[] = [];
  for (const step of steps) {
    const existing = await p.existingGrant(step.product, step.account);
    if (existing === undefined || yes(await t.ask(`${step.account} already has a ${step.product} grant (${existing}). Approve it again? [y/N]`, "n"))) wanted.push(step);
  }
  if (wanted.length === 0) {
    t.say("Every grant you chose already exists.");
    return { made: [], failed: 0 };
  }
  t.say(`Each product gets its own grant per account, holding only that product's access. ${wanted.length === 1 ? "One approval" : `${wanted.length} approvals`} to make.`);
  t.say("");
  t.say("In each one, choose the account the step names. If you chose External, Google first");
  t.say(`warns that it "hasn't verified this app": it is your own app, so click Advanced, then`);
  t.say("Go to (the name you gave it). Click Continue, tick Select all, and click Continue again.");
  t.say("A client made minutes ago can take a few minutes to work; if Google says so, try again.");

  const made: (Step & { readonly address: string })[] = [];
  let failed = 0;
  for (const [i, step] of wanted.entries()) {
    for (;;) {
      const result = await approve(p, step, `${i + 1}/${wanted.length}`);
      if ("address" in result) {
        made.push({ ...step, address: result.address });
        break;
      }
      t.say(`  ${result.problem}`);
      if (!yes(await t.ask("Try again? [Y/n]", "y"))) {
        failed += 1;
        break;
      }
    }
  }
  return { made, failed };
};

const approve = async (p: Ports, step: Step, counter: string): Promise<{ readonly address: string } | { readonly problem: string }> => {
  const t = p.terminal;
  const loopback = await p.listen();
  try {
    const begun = await p.begin(step.product, step.account, loopback.redirectUri);
    t.say("");
    t.say(`${counter}: ${step.product} for ${step.account}${begun.address ? ` (${begun.address})` : ": sign in as the account you want for this label"}`);
    await opened(p, begun.url);
    t.say("  Waiting for Google to send your browser back. If the browser is on another computer,");
    t.say("  it ends on a page that fails to load: paste that page's whole address here.");
    for (;;) {
      const got = await t.askOrWait("Address", loopback.arrived);
      const url = "found" in got ? got.found : got.typed;
      if (!url) continue;
      const finished = await p.complete(url);
      t.say(`  Saved: ${step.account} is ${finished.address} for ${step.product}.`);
      return { address: finished.address };
    }
  } catch (thrown) {
    return { problem: p.describe(thrown) };
  } finally {
    await loopback.close();
  }
};

const finish = (p: Ports, toolsets: readonly Toolset[], done: Outcome): void => {
  const t = p.terminal;
  const { claudeCode, desktop } = installLines(toolsets, p.carried);
  heading(t, done.failed > 0 ? "Almost done" : "Done");
  if (done.failed > 0) t.say(`${done.failed === 1 ? "One approval" : `${done.failed} approvals`} did not finish; run setup again to retry.\n`);
  t.say("Add the server to your assistant. With Claude Code:");
  t.say("");
  t.say(`  ${claudeCode}`);
  t.say("");
  t.say("Claude Desktop (Settings, Developer, Edit Config) and most other clients read the same as JSON:");
  t.say("");
  t.say(desktop.replace(/^/gm, "  "));
  t.say("");
  if (p.carried.length > 0) t.say(`These pass on ${p.carried.map(([n]) => n).join(", ")}, set while setup ran, so the server finds what it saved.`);
  t.say("Restart your client after adding it. To check every grant later:");
  t.say("");
  t.say(`  npx -y ${PACKAGE} --health`);
  t.say("");
  t.say("To add an account or a product, run setup again: it keeps what is already done.");
};
