
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
import { ALL_TOOLSETS, type Toolset } from "./policy.js";
import { editorApisOf } from "./toolsets.js";

/**
 * The tool surface of the loaded toolsets (GOOGLE_TOOLSETS; every one by
 * default): the account and consent tools the products share, then each
 * loaded product's own. A product not loaded registers nothing, so its tools
 * are absent from tools/list rather than listed and failing. Gmail's and
 * Calendar's names are kept as they were. Drive's were generic when it was a
 * server of its own (`list`, `move`, `trash`, the last one taken by Gmail), so
 * here they name what they act on: `list_folder`, `move_file`, `trash_file`.
 * Docs, Sheets and Slides were born here and name their object the same way
 * (`read_document`, `read_rows`, `read_deck`).
 */
export const registerAll = (server: McpServer, registries: Registries, loaded: readonly Toolset[] = ALL_TOOLSETS): void => {
  const has = (toolset: Toolset): boolean => loaded.includes(toolset);
  registerAccounts(server, registries, loaded);
  registerConsent(server, registries.consent);
  if (has("gmail")) registerGmail(server, registries.gmail);
  if (has("calendar")) registerCalendar(server, registries.calendar);
  if (has("drive")) registerDrive(server, registries.drive);
  registerReference(server, editorApisOf(loaded));
  if (has("docs")) registerDocs(server, registries.docs);
  if (has("sheets")) registerSheets(server, registries.sheets);
  if (has("slides")) registerSlides(server, registries.slides);
  if (has("collaboration")) registerCollaboration(server, registries.collaboration);
  if (has("tasks")) registerTasks(server, registries.tasks);
  if (has("contacts")) registerContacts(server, registries.contacts);
  if (has("meet")) registerMeet(server, registries.meet);
};
