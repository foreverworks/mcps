import type { Registry as CalendarRegistry } from "../../calendar/composition.js";
import type { Registry as ContactsRegistry } from "../../contacts/composition.js";
import { OPTIONAL_SCOPES as CONTACTS_OPTIONAL, REQUIRED_SCOPES as CONTACTS_REQUIRED } from "../../contacts/domain/grants.js";
import type { Registry as MeetRegistry } from "../../meet/composition.js";
import { REQUIRED_SCOPES as MEET_REQUIRED } from "../../meet/domain/grants.js";
import type { Registry as TasksRegistry } from "../../tasks/composition.js";
import { REQUIRED_SCOPES as TASKS_REQUIRED } from "../../tasks/domain/grants.js";
import { CALENDAR_EVENTS, CALENDAR_EVENTS_FREEBUSY, CALENDAR_LIST_READONLY } from "../../calendar/domain/grants.js";
import type { DriveGrant } from "../../drive/composition.js";
import type { Editors } from "../../editors/composition.js";
import { NARROW_SCOPES } from "../../editors/domain/grants.js";
import type { Registry as GmailRegistry } from "../../gmail/composition.js";
import { GMAIL_MODIFY, GMAIL_SETTINGS_BASIC } from "../../gmail/domain/grants.js";
import type { ClientConfig } from "../../domain/credentials.js";
import { DRIVE } from "../../domain/scopes.js";
import { readClient } from "../../infra/credentials.js";
import type { Target } from "../app/ports.js";
import type { ConsentProduct } from "../domain/consent.js";
import { configError, fail, inputError } from "../domain/errors.js";

/** The registries that know where each product keeps each account's grant. */
export type Directory = {
  readonly gmail: GmailRegistry;
  readonly calendar: CalendarRegistry;
  readonly editors: Editors;
  readonly drive: DriveGrant;
  readonly tasks: TasksRegistry;
  readonly contacts: ContactsRegistry;
  readonly meet: MeetRegistry;
  /** GOOGLE_OAUTH_CLIENT_FILE: the OAuth client new grants are made on, when the deployment names one. */
  readonly oauthClient?: string | undefined;
};

const NO_CLIENT = "set GOOGLE_OAUTH_CLIENT_FILE to the OAuth client JSON downloaded from the Google Cloud console (a Desktop app client)";

/**
 * Where a consent's grant goes, per product, read from the registries the
 * server already serves those grants from, so a consent writes exactly the
 * file the product reads:
 *
 *   gmail     the account's modify grant (GMAIL_MODIFY_ACCOUNTS)              gmail.modify,
 *                                                                              gmail.settings.basic (filters)
 *   calendar  <calendar root>/<account>/credentials.json                       calendar.events,
 *                                                                              calendar.calendarlist.readonly,
 *                                                                              calendar.events.freebusy
 *   editors   <editors root>/<account>/credentials.json                        documents, spreadsheets,
 *                                                                              presentations, drive.file
 *   drive     Drive's own grant (DRIVE_CREDENTIALS), its one account           drive
 *   tasks     <tasks root>/<account>/credentials.json                          tasks
 *   contacts  <contacts root>/<account>/credentials.json                       contacts.readonly,
 *                                                                              contacts.other.readonly,
 *                                                                              directory.readonly (optional)
 *   meet      <meet root>/<account>/credentials.json                           meetings.space.readonly
 *
 * The address a consent must be approved as is the one configured for the
 * account (GMAIL_ADDRESSES first, then the address an earlier grant recorded).
 * The client is GOOGLE_OAUTH_CLIENT_FILE's when it is set, else the one in any
 * credentials file the account already has (Drive's: its own grant's, else
 * the rclone remote's).
 */
export const makeTargets = (dir: Directory) => {
  const addressOf = (account: string): string =>
    dir.gmail.addressOf(account) ??
    dir.calendar.specOf(account)?.address ??
    [dir.tasks, dir.contacts, dir.meet].map((r) => r.specOf(account)?.address).find((a) => a !== undefined) ??
    dir.editors.specs().flatMap((s) => (s.label === account && s.source === "credentials" && s.address ? [s.address] : []))[0] ??
    fail(configError(`no address is known for "${account}": add ${account}=<address> to GMAIL_ADDRESSES so a consent can be checked against it`));

  /** The deployment's client, when it names one. */
  const configured = async (): Promise<ClientConfig | undefined> => {
    if (dir.oauthClient === undefined) return undefined;
    return (await readClient(dir.oauthClient)) ?? fail(configError(`GOOGLE_OAUTH_CLIENT_FILE (${dir.oauthClient}) holds no OAuth client (client_id and client_secret)`));
  };

  /** The configured client, else the one the account's existing credentials files carry, in the order they are trusted. */
  const clientOf = (account: string) => async (): Promise<ClientConfig> => {
    const named = await configured();
    if (named) return named;
    const gmail = dir.gmail.specOf(account);
    const files = [
      gmail?.modify,
      gmail?.readonly,
      dir.calendar.credentialsPath(account),
      dir.editors.credentialsPath(account),
      ...[dir.tasks, dir.contacts, dir.meet].map((r) => r.credentialsPath(account)),
    ].filter(
      (f): f is string => f !== undefined,
    );
    for (const file of files) {
      const client = await readClient(file);
      if (client) return client;
    }
    return fail(configError(`no OAuth client is known for "${account}": ${NO_CLIENT}`));
  };

  const gmail = (account: string): Target => {
    const spec = dir.gmail.specOf(account) ?? fail(configError(`"${account}" is not a mailbox here: add ${account}=<path> to GMAIL_MODIFY_ACCOUNTS`));
    return {
      product: "gmail",
      account,
      address: addressOf(account),
      scopes: [GMAIL_MODIFY, GMAIL_SETTINGS_BASIC],
      credentialsPath: spec.modify ?? fail(configError(`"${account}" has no modify grant path: add ${account}=<path> to GMAIL_MODIFY_ACCOUNTS`)),
      client: clientOf(account),
      forget: () => dir.gmail.forget(account, "modify"),
    };
  };

  /**
   * Drive holds one grant. When an editors label runs on it
   * (GOOGLE_EDITORS_DRIVE_ACCOUNT), only that account may consent it, or Docs,
   * Sheets and Slides would act as someone else under that label.
   */
  const drive = (account: string): Target => {
    const bound = dir.editors.driveLabel;
    if (bound && account !== bound) {
      return fail(inputError(`Drive's grant is the "${bound}" account's (GOOGLE_EDITORS_DRIVE_ACCOUNT), not "${account}"`));
    }
    return {
      product: "drive",
      account,
      address: addressOf(account),
      scopes: [DRIVE],
      credentialsPath: dir.drive.credentials,
      client: async () => (await configured()) ?? dir.drive.client(),
      // One token provider serves Drive and the editors account that runs on it.
      forget: dir.drive.tokens.forget,
    };
  };

  /** A product holding one grant per account under its root (src/grants/registry.ts). */
  const grantTarget = (
    product: ConsentProduct,
    account: string,
    registry: { readonly credentialsPath: (label: string) => string; readonly forget: (label: string) => Promise<void> },
    scopes: readonly string[],
    optionalScopes: readonly string[] = [],
  ): Target => ({
    product,
    account,
    address: addressOf(account),
    scopes,
    ...(optionalScopes.length ? { optionalScopes } : {}),
    credentialsPath: registry.credentialsPath(account),
    client: clientOf(account),
    forget: () => registry.forget(account),
  });

  return async (product: ConsentProduct, account: string): Promise<Target> => {
    switch (product) {
      case "gmail":
        return gmail(account);
      case "drive":
        return drive(account);
      case "calendar":
        return {
          product,
          account,
          address: addressOf(account),
          scopes: [CALENDAR_EVENTS, CALENDAR_LIST_READONLY, CALENDAR_EVENTS_FREEBUSY],
          credentialsPath: dir.calendar.credentialsPath(account),
          client: clientOf(account),
          forget: () => dir.calendar.forget(account),
        };
      case "editors":
        return {
          product,
          account,
          address: addressOf(account),
          scopes: NARROW_SCOPES,
          credentialsPath: dir.editors.credentialsPath(account),
          client: clientOf(account),
          forget: () => dir.editors.forget(account),
        };
      case "tasks":
        return grantTarget(product, account, dir.tasks, TASKS_REQUIRED);
      case "contacts":
        return grantTarget(product, account, dir.contacts, CONTACTS_REQUIRED, CONTACTS_OPTIONAL);
      case "meet":
        return grantTarget(product, account, dir.meet, MEET_REQUIRED);
    }
  };
};
