
import type { McpServer } from "@foreverworks/mcp-kit";
import { registerAll as registerCalendar } from "../calendar/mcp/register.js";
import { registerAll as registerCollaboration } from "../collaboration/mcp/register.js";
import { registerAll as registerConsent } from "../consent/mcp/register.js";
import { registerAll as registerContacts } from "../contacts/mcp/register.js";
import type { Registries } from "../composition.js";
import { registerAll as registerDocs } from "../docs/mcp/register.js";
import { registerAll as registerDrive } from "../drive/mcp/register.js";
import { registerReference } from "../editors/mcp/reference.js";
import { registerAll as registerGmail } from "../gmail/mcp/register.js";
import { registerAll as registerMeet } from "../meet/mcp/register.js";
import { registerAll as registerSheets } from "../sheets/mcp/register.js";
import { registerAll as registerSlides } from "../slides/mcp/register.js";
import { registerAll as registerTasks } from "../tasks/mcp/register.js";
import { registerAccounts } from "./accounts.js";

/**
 * The whole tool surface: the account tools the products share, then each
 * product's own. Gmail's and Calendar's names are kept as they were. Drive's
 * were generic when it was a server of its own (`list`, `move`, `trash`, the
 * last one taken by Gmail), so here they name what they act on: `list_folder`,
 * `move_file`, `trash_file`. Docs, Sheets and Slides were born here and name
 * their object the same way (`read_document`, `read_rows`, `read_deck`).
 */
export const registerAll = (server: McpServer, registries: Registries): void => {
  registerAccounts(server, registries);
  registerConsent(server, registries.consent);
  registerGmail(server, registries.gmail);
  registerCalendar(server, registries.calendar);
  registerDrive(server, registries.drive);
  registerReference(server);
  registerDocs(server, registries.docs);
  registerSheets(server, registries.sheets);
  registerSlides(server, registries.slides);
  registerCollaboration(server, registries.collaboration);
  registerTasks(server, registries.tasks);
  registerContacts(server, registries.contacts);
  registerMeet(server, registries.meet);
};
