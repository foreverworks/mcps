import { buildRegistry as buildCalendar, type Registry as CalendarRegistry } from "./calendar/composition.js";
import { buildRegistry as buildCollaboration, type Registry as CollaborationRegistry } from "./collaboration/composition.js";
import { buildRegistry as buildContacts, type Registry as ContactsRegistry } from "./contacts/composition.js";
import type { Deps as ConsentDeps } from "./consent/app/ports.js";
import { buildConsent } from "./consent/composition.js";
import { buildRegistry as buildDocs, type Registry as DocsRegistry } from "./docs/composition.js";
import type { Deps as DriveDeps } from "./drive/app/ports.js";
import { buildDeps as buildDrive, buildGrant as buildDriveGrant, type DriveGrant } from "./drive/composition.js";
import { buildEditors, type Editors } from "./editors/composition.js";
import { buildRegistry as buildGmail, type Registry as GmailRegistry } from "./gmail/composition.js";
import { codeOfEvent } from "./meet/domain/meetings.js";
import { buildRegistry as buildMeet, type EventReader, type Registry as MeetRegistry } from "./meet/composition.js";
import { buildRegistry as buildSheets, type Registry as SheetsRegistry } from "./sheets/composition.js";
import { buildRegistry as buildSlides, type Registry as SlidesRegistry } from "./slides/composition.js";
import { tasksDue } from "./tasks/app/usecases.js";
import { buildRegistry as buildTasks, type Registry as TasksRegistry } from "./tasks/composition.js";
import { reconsent } from "./domain/errors.js";

export type Registries = {
  readonly gmail: GmailRegistry;
  readonly calendar: CalendarRegistry;
  /** One account: Drive's own grant, or an rclone remote's. */
  readonly drive: DriveDeps;
  /** The grants Docs, Sheets and Slides share: the account `GOOGLE_EDITORS_DRIVE_ACCOUNT` names on the Drive grant, others discovered on disk. */
  readonly editors: Editors;
  readonly docs: DocsRegistry;
  readonly sheets: SheetsRegistry;
  readonly slides: SlidesRegistry;
  /** Comments, sharing and revisions on any Drive file, as an editors account. */
  readonly collaboration: CollaborationRegistry;
  /** Google Tasks, one grant per account. */
  readonly tasks: TasksRegistry;
  /** Contacts and a Workspace directory (the People API), one grant per account. */
  readonly contacts: ContactsRegistry;
  /** Meet's records and transcripts, one grant per account; an event is read through Calendar. */
  readonly meet: MeetRegistry;
  /** Consent through the server: where each product's grant goes, and the consents waiting for their redirect. */
  readonly consent: ConsentDeps;
};

/** The agenda's tasks: the accounts it reads that have a Tasks grant. */
const tasksDueFor = (tasks: TasksRegistry) => async (accounts: readonly string[], window: { readonly timeMin: string; readonly timeMax: string; readonly timeZone: string }) => {
  const wanted = tasks.labels.filter((l) => accounts.includes(l));
  if (wanted.length === 0) return { tasks: [], hint: `no Google Tasks grant for ${accounts.join(", ") || "any account"}; ${reconsent("tasks")}` };
  return tasksDue(wanted.map((l) => tasks.get(l)), window);
};

/** An event, as Meet needs it, read through the account's Calendar grant. */
const eventReader = (calendar: CalendarRegistry): EventReader => (account) => async (calendarId, eventId) => {
  const event = await calendar.get(account).calendar.get(calendarId, eventId);
  const timed = event.start?.dateTime && event.end?.dateTime && !(event.recurrence?.length);
  const code = codeOfEvent(event);
  return {
    title: event.summary ?? "(no title)",
    ...(code ? { code } : {}),
    ...(timed ? { start: Date.parse(event.start?.dateTime ?? ""), end: Date.parse(event.end?.dateTime ?? "") } : {}),
  };
};

/**
 * The Drive grant, the Drive deps on it, and the editors registry, one of
 * whose accounts may run on that same grant. Its own function so the shell
 * health check builds exactly what the server builds.
 */
export const buildDriveAndEditors = (
  env: NodeJS.ProcessEnv = process.env,
): { readonly grant: DriveGrant; readonly drive: DriveDeps; readonly editors: Editors } => {
  const grant = buildDriveGrant(env);
  const drive = buildDrive(env, grant);
  return { grant, drive, editors: buildEditors(env, { grant, drive }) };
};

/**
 * Every product, built once per process and shared by every session that
 * reaches it.
 *
 * Each keeps its own accounts, grants and token caches. Gmail and Calendar
 * hold SEPARATE grants (usually on the same OAuth client), and Drive uses its
 * own grant or, until it has one, an rclone remote's; a token minted for one
 * is never handed to another. Docs, Sheets and Slides are the exception by
 * design: the account GOOGLE_EDITORS_DRIVE_ACCOUNT names IS the Drive grant
 * (the full drive scope covers all three APIs), so the Drive grant is built
 * once here and the one token provider serves all four. Consent reaches into
 * every registry, because it writes the grant each one reads.
 *
 * Nothing here touches the network or a credential: the registries parse
 * configuration and fail only on a malformed variable (a label=path list that
 * does not parse), which stops the process at start rather than inside a tool
 * call. A missing grant or an unset credential is a tool-call failure.
 */
export const buildRegistries = (env: NodeJS.ProcessEnv = process.env): Registries => {
  const { grant, drive, editors } = buildDriveAndEditors(env);
  const gmail = buildGmail(env);
  const tasks = buildTasks(env);
  const calendar = buildCalendar(env, { tasksDue: tasksDueFor(tasks) });
  const contacts = buildContacts(env);
  const meet = buildMeet(env, eventReader(calendar));
  return {
    gmail,
    calendar,
    tasks,
    contacts,
    meet,
    drive,
    editors,
    docs: buildDocs(editors),
    sheets: buildSheets(editors),
    slides: buildSlides(editors),
    collaboration: buildCollaboration(editors),
    consent: buildConsent(env, { gmail, calendar, editors, drive: grant, tasks, contacts, meet }),
  };
};
