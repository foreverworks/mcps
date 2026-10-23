import { mergePolicies, type ToolPolicy } from "@foreverworks/mcp-kit";

import { COLLABORATION } from "../collaboration/policy.js";
import { CONSENT } from "../consent/policy.js";
import { CONTACTS } from "../contacts/policy.js";
import { DOCS } from "../docs/policy.js";
import { EDITORS } from "../editors/policy.js";
import { MEET } from "../meet/policy.js";
import { SHEETS } from "../sheets/policy.js";
import { SLIDES } from "../slides/policy.js";
import { TASKS } from "../tasks/policy.js";

/**
 * Every tool of the server, classified (packages/mcp-kit, policy.ts), one map
 * per product so each product's list sits beside its tools. Nothing here is
 * `money`; the outward writes (a sent mail, an invitation answered) are `write`,
 * and their descriptions say a send needs the user's explicit go. A write marked
 * `idempotent` sets a state rather than adding one (labels on or off, a message
 * in or out of the trash); test/gmail/idempotent.test.ts holds each to that.
 */
const SERVER: ToolPolicy = {
  list_accounts: { access: "read" },
  health: { access: "read" },
};

const GMAIL: ToolPolicy = {
  search_threads: { access: "read" },
  get_thread: { access: "read" },
  get_message: { access: "read" },
  get_messages: { access: "read" },
  get_attachment: { access: "read" },
  harvest_attachments: { access: "read" },
  list_history: { access: "read" },
  list_labels: { access: "read" },
  get_draft: { access: "read" },
  list_drafts: { access: "read" },
  create_draft: { access: "write" },
  update_draft: { access: "write" },
  delete_draft: { access: "write" },
  send_draft: { access: "write" },
  send_message: { access: "write" },
  reply: { access: "write" },
  forward: { access: "write" },
  create_label: { access: "write" },
  update_label: { access: "write" },
  delete_label: { access: "write" },
  modify_labels: { access: "write", idempotent: true },
  modify_labels_matching: { access: "write" },
  sender_breakdown: { access: "read" },
  list_filters: { access: "read" },
  create_filter: { access: "write" },
  delete_filter: { access: "write" },
  trash: { access: "write", idempotent: true },
  untrash: { access: "write", idempotent: true },
  mark_spam: { access: "write", idempotent: true },
  unmark_spam: { access: "write", idempotent: true },
};

const CALENDAR: ToolPolicy = {
  agenda: { access: "read" },
  list_calendars: { access: "read" },
  get_event: { access: "read" },
  free_busy: { access: "read" },
  find_time: { access: "read" },
  create_event: { access: "write" },
  update_event: { access: "write" },
  delete_event: { access: "write" },
  respond_to_invite: { access: "write" },
};

const DRIVE: ToolPolicy = {
  start_drive_cursor: { access: "read" },
  drive_changes: { access: "read" },
  resolve_path: { access: "read" },
  path_of: { access: "read" },
  list_folder: { access: "read" },
  find_files: { access: "read" },
  describe_file: { access: "read" },
  read_doc: { access: "read" },
  copy_file: { access: "write" },
  move_file: { access: "write" },
  rename_file: { access: "write" },
  create_folder: { access: "write" },
  trash_file: { access: "write" },
  untrash_file: { access: "write" },
  upload_file: { access: "write" },
  // Writes only into its downloads folder; on Drive it reads.
  download_file: { access: "read" },
};

/**
 * The products whose tools carry the product's icon in tools/list
 * (icons/<product>-32.png, drawn by scripts/icons.ts). The account, consent,
 * full-API and collaboration tools span products and carry none.
 */
export const PRODUCTS: Readonly<Record<string, ToolPolicy>> = { gmail: GMAIL, calendar: CALENDAR, drive: DRIVE, docs: DOCS, sheets: SHEETS, slides: SLIDES, tasks: TASKS, contacts: CONTACTS, meet: MEET };

export const POLICY: ToolPolicy = mergePolicies(SERVER, CONSENT, GMAIL, CALENDAR, DRIVE, EDITORS, DOCS, SHEETS, SLIDES, COLLABORATION, TASKS, CONTACTS, MEET);
