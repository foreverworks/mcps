import type { McpServer } from "@foreverworks/mcp-kit";
import { z } from "zod";

import * as calendar from "../calendar/mcp/controllers/accounts.js";
import { describeThrown as describeCalendar } from "../calendar/domain/errors.js";
import { checkHealth as checkDrive } from "../drive/app/usecases/health.js";
import { describeThrown as describeDrive } from "../drive/domain/errors.js";
import { describeThrown as describeEditors } from "../editors/domain/errors.js";
import * as editors from "../editors/mcp/accounts.js";
import type { Registries } from "../composition.js";
import { checkHealth as checkContacts } from "../contacts/app/usecases.js";
import { describeThrown as describeContacts, RECONSENT as CONTACTS_RECONSENT } from "../contacts/domain/errors.js";
import { ALL_ACCOUNTS } from "../domain/accounts.js";
import { grantAccountsHealth, listGrantAccounts } from "../grants/accounts.js";
import { checkHealth as checkMeet } from "../meet/app/usecases.js";
import { describeThrown as describeMeet, RECONSENT as MEET_RECONSENT } from "../meet/domain/errors.js";
import { checkHealth as checkTasks } from "../tasks/app/usecases.js";
import { describeThrown as describeTasks, RECONSENT as TASKS_RECONSENT } from "../tasks/domain/errors.js";
import * as gmail from "../gmail/mcp/controllers/accounts.js";
import { describeThrown as describeGmail } from "../gmail/domain/errors.js";
import { listed } from "../domain/words.js";
import { handled } from "./envelope.js";
import type { Toolset } from "./policy.js";

/**
 * One product's section, or why it has none. A product whose configuration is
 * broken must not hide the other's answer: that is the whole point of asking
 * both in one call.
 */
const section = async <T>(describe: (thrown: unknown) => string, build: () => T | Promise<T>) => {
  try {
    return await build();
  } catch (thrown) {
    return { error: describe(thrown) };
  }
};

type Checked = { readonly allOk: boolean } | { readonly ok: boolean } | { readonly error: string };

const allOk = (s: Checked): boolean => ("allOk" in s && s.allOk) || ("ok" in s && s.ok);

/** The products with a section of their own in list_accounts and health, in that order. */
type Section = "gmail" | "calendar" | "drive" | "editors" | "tasks" | "contacts" | "meet";

/**
 * Each section, the toolsets whose tools run on its grants, and what it says
 * in each tool's description. A section is there when one of its toolsets is
 * loaded (GOOGLE_TOOLSETS): comments, sharing and revisions run as an editors
 * account, so they bring the editors' section. Tasks, contacts and Meet share
 * one sentence, which names those loaded.
 */
const SECTIONS: Readonly<Record<Section, { readonly toolsets: readonly Toolset[]; readonly listed?: string; readonly checked?: string }>> = {
  gmail: {
    toolsets: ["gmail"],
    listed:
      "Under `gmail`: the mailboxes, which one a tool uses when no account is given, and which grant each runs on: " +
      "`modify` (its own; the write tools work) or `readonly` (a read-only grant; the write tools refuse).",
    checked:
      "Under `gmail`, per grant: the mailbox each credential resolves to, the scope Google actually GRANTED (not the one " +
      "credentials.json declares), whether it can write, and the OAuth client the live token belongs to; an account may " +
      "hold its own gmail.modify grant and a gmail.readonly one, and `activeGrant` is the one the tools use.",
  },
  calendar: {
    toolsets: ["calendar"],
    listed: "Under `calendar`: the accounts whose calendars it reaches, the address each grant must resolve to, and the time zone.",
    checked:
      "Under `calendar`: that the grant refreshes, which account it resolves to (the consent screen offers every account " +
      "signed in), and whether it carries the scopes the tools need.",
  },
  drive: {
    toolsets: ["drive"],
    listed: "Under `drive`: which grant Drive runs on (its own once begin_consent made one, else an rclone remote's when one is configured).",
    checked: "Under `drive`: which account the grant acts as and the storage used.",
  },
  editors: {
    toolsets: ["docs", "sheets", "slides", "collaboration"],
    listed:
      "Under `editors`: the accounts Docs, Sheets and Slides can act as (one may run on the Drive grant; any other needs " +
      "a grant made with begin_consent).",
    checked:
      "Under `editors` (Docs, Sheets, Slides), per account: the address, the granted scopes, and whether each of the three " +
      "APIs is enabled in the grant's Cloud project.",
  },
  tasks: { toolsets: ["tasks"] },
  contacts: { toolsets: ["contacts"] },
  meet: { toolsets: ["meet"] },
};

/** The one-grant-per-account products, and what list_accounts says each grant is for. */
const GRANTS: Readonly<Partial<Record<Section, string>>> = { tasks: "for Google Tasks", contacts: "for contacts and the directory", meet: "for Meet's records" };

/** The sections the loaded toolsets bring, in order. */
export const sectionsOf = (loaded: readonly Toolset[]): readonly Section[] =>
  (Object.keys(SECTIONS) as Section[]).filter((s) => SECTIONS[s].toolsets.some((t) => loaded.includes(t)));

/** list_accounts' description, naming the sections loaded. With every one, it reads as it always has. */
const listedDescription = (sections: readonly Section[]): string => {
  const grants = sections.filter((s) => GRANTS[s] !== undefined);
  return [
    "The Google accounts this server reaches, per product. Start here: every other tool takes one of these labels.",
    ...sections.flatMap((s) => SECTIONS[s].listed ?? []),
    ...(grants.length === 0
      ? []
      : [`Under ${listed(grants.map((s) => `\`${s}\``), "and")}: the accounts with a grant ${listed(grants.map((s) => GRANTS[s] ?? ""), "and", true)}.`]),
    "Says nothing about whether a grant is alive; that is health, which costs a round trip to Google.",
  ].join(" ");
};

/** health's description, naming the sections loaded. With every one, it reads as it always has. */
const checkedDescription = (sections: readonly Section[]): string => {
  const grants = sections.filter((s) => GRANTS[s] !== undefined);
  return [
    "Check that every grant is alive, per product and per account.",
    ...sections.flatMap((s) => SECTIONS[s].checked ?? []),
    ...(grants.length === 0
      ? []
      : [
          `Under ${listed(grants.map((s) => `\`${s}\``), "and")}, per account with a grant: the address, the granted scopes, and whether ` +
            `the API answers (\`disabled\` when its Cloud project has not enabled it)${grants.includes("contacts") ? "; contacts also says which sources it reads" : ""}.`,
        ]),
    "Checks EVERY account by default. Run this before concluding the server is broken, and before retrying a write that refused.",
  ].join(" ");
};

/** Each section of list_accounts. */
const LIST: Readonly<Record<Section, (registries: Registries) => Promise<unknown>>> = {
  gmail: (r) => section(describeGmail, () => gmail.listAccounts(r.gmail)),
  calendar: (r) => section(describeCalendar, () => calendar.listAccounts(r.calendar)),
  drive: async (r) => ({ grant: r.drive.grant() }),
  editors: (r) => section(describeEditors, () => editors.listAccounts(r.editors)),
  tasks: (r) => section(describeTasks, () => listGrantAccounts(r.tasks, TASKS_RECONSENT)),
  contacts: (r) => section(describeContacts, () => listGrantAccounts(r.contacts, CONTACTS_RECONSENT)),
  meet: (r) => section(describeMeet, () => listGrantAccounts(r.meet, MEET_RECONSENT)),
};

/** Each section of health. */
const CHECK: Readonly<Record<Section, (registries: Registries, account: string) => Promise<Checked>>> = {
  gmail: (r, account) => section(describeGmail, () => gmail.health(r.gmail, account)),
  calendar: (r, account) => section(describeCalendar, () => calendar.health(r.calendar, account)),
  drive: (r) => section(describeDrive, () => checkDrive(r.drive)),
  editors: (r, account) => section(describeEditors, () => editors.health(r.editors, account)),
  tasks: (r, account) => section(describeTasks, () => grantAccountsHealth(r.tasks, account, checkTasks, describeTasks)),
  contacts: (r, account) => section(describeContacts, () => grantAccountsHealth(r.contacts, account, checkContacts, describeContacts)),
  meet: (r, account) => section(describeMeet, () => grantAccountsHealth(r.meet, account, checkMeet, describeMeet)),
};

/**
 * The two tools that are about the ACCOUNT rather than the mail, the calendar
 * or the files in it. One label names one Google identity in every product;
 * Drive holds one grant. One list and one health check, each with a section
 * per product loaded.
 */
export const registerAccounts = (server: McpServer, registries: Registries, loaded: readonly Toolset[]): void => {
  const sections = sectionsOf(loaded);

  server.registerTool(
    "list_accounts",
    {
      title: "List accounts",
      description: listedDescription(sections),
      inputSchema: {},
    },
    handled(async () => Object.fromEntries(await Promise.all(sections.map(async (s) => [s, await LIST[s](registries)] as const)))),
  );

  server.registerTool(
    "health",
    {
      title: "Health",
      description: checkedDescription(sections),
      inputSchema: {
        account: z
          .string()
          .default(ALL_ACCOUNTS)
          .describe(`Which account: a label from list_accounts, or "${ALL_ACCOUNTS}" for every account (the default).`),
      },
    },
    handled(async (args: { account: string }) => {
      const checked = await Promise.all(sections.map(async (s) => [s, await CHECK[s](registries, args.account)] as const));
      return { ...Object.fromEntries(checked), allOk: checked.every(([, c]) => allOk(c)) };
    }),
  );
};
