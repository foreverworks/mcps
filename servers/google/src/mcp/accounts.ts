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
import { handled } from "./envelope.js";

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

const allOk = (s: { readonly allOk: boolean } | { readonly ok: boolean } | { readonly error: string }): boolean =>
  ("allOk" in s && s.allOk) || ("ok" in s && s.ok);

/**
 * The two tools that are about the ACCOUNT rather than the mail, the calendar
 * or the files in it. One label names one Google identity in every product;
 * Drive holds one grant. One list and one health check, each with a section
 * per product.
 */
export const registerAccounts = (server: McpServer, registries: Registries): void => {
  server.registerTool(
    "list_accounts",
    {
      title: "List accounts",
      description:
        "The Google accounts this server reaches, per product. Start here: every other tool takes one of these " +
        "labels. Under `gmail`: the mailboxes, which one a tool uses when no account is given, and which grant each " +
        "runs on: `modify` (its own; the write tools work) or `readonly` (a read-only grant; the write tools refuse). " +
        "Under `calendar`: the accounts whose calendars it reaches, the address each grant must resolve to, and the " +
        "time zone. Under `drive`: which grant Drive runs on (its own once begin_consent made one, else an rclone " +
        "remote's when one is configured). Under `editors`: the accounts Docs, Sheets and Slides can act as (one may " +
        "run on the Drive grant; any other needs a grant made with begin_consent). Under `tasks`, `contacts` and " +
        "`meet`: the accounts with a grant for Google Tasks, for contacts and the directory, and for Meet's records. Says nothing about whether a " +
        "grant is alive; that is health, which costs a round trip to Google.",
      inputSchema: {},
    },
    handled(async () => {
      const [mail, cal, docs, tasks, contacts, meet] = await Promise.all([
        section(describeGmail, () => gmail.listAccounts(registries.gmail)),
        section(describeCalendar, () => calendar.listAccounts(registries.calendar)),
        section(describeEditors, () => editors.listAccounts(registries.editors)),
        section(describeTasks, () => listGrantAccounts(registries.tasks, TASKS_RECONSENT)),
        section(describeContacts, () => listGrantAccounts(registries.contacts, CONTACTS_RECONSENT)),
        section(describeMeet, () => listGrantAccounts(registries.meet, MEET_RECONSENT)),
      ]);
      return { gmail: mail, calendar: cal, drive: { grant: registries.drive.grant() }, editors: docs, tasks, contacts, meet };
    }),
  );

  server.registerTool(
    "health",
    {
      title: "Health",
      description:
        "Check that every grant is alive, per product and per account. Under `gmail`, per grant: the mailbox each " +
        "credential resolves to, the scope Google actually GRANTED (not the one credentials.json declares), whether " +
        "it can write, and the OAuth client the live token belongs to; an account may hold its own gmail.modify grant " +
        "and a gmail.readonly one, and `activeGrant` is the one the tools use. " +
        "Under `calendar`: that the grant refreshes, which account it resolves to (the consent screen offers every account signed in), " +
        "and whether it carries the scopes the tools need. Under `drive`: which account the grant acts as and the " +
        "storage used. Under `editors` (Docs, Sheets, Slides), per account: the address, the granted scopes, and " +
        "whether each of the three APIs is enabled in the grant's Cloud project. Under `tasks`, `contacts` and `meet`, per " +
        "account with a grant: the address, the granted scopes, and whether the API answers (`disabled` when its Cloud " +
        "project has not enabled it); contacts also says which sources it reads. Checks EVERY account by default. Run this before " +
        "concluding the server is broken, and before retrying a write that refused.",
      inputSchema: {
        account: z
          .string()
          .default(ALL_ACCOUNTS)
          .describe(`Which account: a label from list_accounts, or "${ALL_ACCOUNTS}" for every account (the default).`),
      },
    },
    handled(async (args: { account: string }) => {
      const [mail, cal, files, docs, tasks, contacts, meet] = await Promise.all([
        section(describeGmail, () => gmail.health(registries.gmail, args.account)),
        section(describeCalendar, () => calendar.health(registries.calendar, args.account)),
        section(describeDrive, () => checkDrive(registries.drive)),
        section(describeEditors, () => editors.health(registries.editors, args.account)),
        section(describeTasks, () => grantAccountsHealth(registries.tasks, args.account, checkTasks, describeTasks)),
        section(describeContacts, () => grantAccountsHealth(registries.contacts, args.account, checkContacts, describeContacts)),
        section(describeMeet, () => grantAccountsHealth(registries.meet, args.account, checkMeet, describeMeet)),
      ]);
      return {
        gmail: mail,
        calendar: cal,
        drive: files,
        editors: docs,
        tasks,
        contacts,
        meet,
        allOk: [mail, cal, files, docs, tasks, contacts, meet].every(allOk),
      };
    }),
  );
};
