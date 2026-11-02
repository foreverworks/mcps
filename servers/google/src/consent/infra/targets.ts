import type { Registry as CalendarRegistry } from "../../calendar/composition.js";
import type { Registry as ContactsRegistry } from "../../contacts/composition.js";
import type { Registry as MeetRegistry } from "../../meet/composition.js";
import type { Registry as TasksRegistry } from "../../tasks/composition.js";
import type { DriveGrant } from "../../drive/composition.js";
import type { Editors } from "../../editors/composition.js";
import type { Registry as GmailRegistry } from "../../gmail/composition.js";
import type { ClientConfig } from "../../domain/credentials.js";
import { readClient } from "../../infra/credentials.js";
import type { ClientSource } from "../../infra/locations.js";
import type { Target } from "../app/ports.js";
import type { ConsentProduct } from "../domain/consent.js";
import { CONSENT_SCOPES } from "../domain/products.js";
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
  /** The OAuth client new grants are made on, when the deployment names one or setup saved one; asked when a consent begins. */
  readonly oauthClient: () => ClientSource | undefined;
};

const NO_CLIENT = "run `npx @foreverworks/mcp-google setup`, or set GOOGLE_OAUTH_CLIENT_FILE to the OAuth client JSON downloaded from the Google Cloud console (a Desktop app client)";

/** An address, and what said it: GMAIL_ADDRESSES, or the grant file whose consent recorded it. */
export type KnownAddress = { readonly address: string; readonly from: string };

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
 * account (GMAIL_ADDRESSES first, then the address an earlier grant recorded);
 * an account nothing knows yet has none, and only a consent begun to learn it
 * (setup's) may go ahead without one. The client is GOOGLE_OAUTH_CLIENT_FILE's
 * when it is set, else the one setup saved, else the one in any credentials
 * file the account already has (Drive's: its own grant's, else the rclone
 * remote's).
 */
export const makeTargets = (dir: Directory) => {
  /** The account's address and its source, in the order they are trusted; undefined when nothing knows it yet. */
  const knownAddress = (account: string): KnownAddress | undefined => {
    const gmail = dir.gmail.addressOf(account);
    if (gmail) return { address: gmail, from: dir.gmail.addressFromOf(account) ?? "GMAIL_ADDRESSES" };
    const specs = [dir.calendar, dir.tasks, dir.contacts, dir.meet].map((r) => r.specOf(account));
    const spec = specs.find((s) => s?.address !== undefined);
    if (spec?.address) return { address: spec.address, from: spec.credentials };
    return dir.editors
      .specs()
      .flatMap((s) => (s.label === account && s.source === "credentials" && s.address ? [{ address: s.address, from: s.credentials }] : []))[0];
  };
  const addressOf = (account: string): string | undefined => knownAddress(account)?.address;

  /** The deployment's client, or setup's, when there is one. */
  const configured = async (): Promise<ClientConfig | undefined> => {
    const source = dir.oauthClient();
    if (source === undefined) return undefined;
    const what = source.from === "setup" ? "the OAuth client setup saved" : "GOOGLE_OAUTH_CLIENT_FILE";
    return (await readClient(source.path)) ?? fail(configError(`${what} (${source.path}) holds no OAuth client (client_id and client_secret)`));
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
    const credentialsPath =
      dir.gmail.modifyPathOf(account) ??
      fail(
        configError(
          dir.gmail.specOf(account)
            ? `"${account}" has no modify grant path: add ${account}=<path> to GMAIL_MODIFY_ACCOUNTS`
            : `"${account}" is not a mailbox here: add ${account}=<path> to GMAIL_MODIFY_ACCOUNTS`,
        ),
      );
    return { ...scoped("gmail", account), credentialsPath, client: clientOf(account), forget: () => dir.gmail.forget(account, "modify") };
  };

  /** What every target says about its product and account: who must approve, and what it asks for. */
  const scoped = (product: ConsentProduct, account: string) => {
    const { required, optional } = CONSENT_SCOPES[product];
    const address = addressOf(account);
    return { product, account, ...(address ? { address } : {}), scopes: required, ...(optional.length ? { optionalScopes: optional } : {}) };
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
      ...scoped("drive", account),
      credentialsPath: dir.drive.credentials,
      client: async () => (await configured()) ?? dir.drive.client(),
      // One token provider serves Drive and the editors account that runs on it.
      forget: dir.drive.tokens.forget,
    };
  };

  /** A product holding one grant per account under its root (src/grants/registry.ts), Calendar and the editors included. */
  const grantTarget = (
    product: ConsentProduct,
    account: string,
    registry: { readonly credentialsPath: (label: string) => string; readonly forget: (label: string) => Promise<void> },
  ): Target => ({
    ...scoped(product, account),
    credentialsPath: registry.credentialsPath(account),
    client: clientOf(account),
    forget: () => registry.forget(account),
  });

  const target = async (product: ConsentProduct, account: string): Promise<Target> => {
    switch (product) {
      case "gmail":
        return gmail(account);
      case "drive":
        return drive(account);
      case "calendar":
        return grantTarget(product, account, dir.calendar);
      case "editors":
        return grantTarget(product, account, dir.editors);
      case "tasks":
        return grantTarget(product, account, dir.tasks);
      case "contacts":
        return grantTarget(product, account, dir.contacts);
      case "meet":
        return grantTarget(product, account, dir.meet);
    }
  };

  /**
   * Every account any product knows, with its address and where that address
   * came from, by name: what health reports as the accounts' configuration.
   */
  const known = (): readonly (readonly [string, KnownAddress | undefined])[] => {
    const labels = new Set([
      ...dir.gmail.labels,
      ...dir.gmail.addressed(),
      ...[dir.calendar, dir.tasks, dir.contacts, dir.meet].flatMap((r) => r.labels),
      ...dir.editors.specs().map((s) => s.label),
    ]);
    return [...labels].sort((a, b) => a.localeCompare(b)).map((label) => [label, knownAddress(label)] as const);
  };

  return { target, known };
};
