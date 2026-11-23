# What this server cannot do, and why

You asked for something and the server refused, or you are deciding whether it
fits before you install it. This page says, product by product, what is
missing, whether the reason is Google's API or a choice made here, and what to
do instead. The [README's Limitations](../README.md#limitations) is the short
list; this is the reasoning behind it.

Each row names one of three reasons:

- **API**: Google's API offers no request for it, so no server can do it
  through the API.
- **Choice**: the API allows it and this server leaves it out on purpose, so
  that what it can do stays safe to hand to an assistant.
- **Not built**: the API allows it and nobody has written it yet.

## Mail

| You want | Reason | Why, and what to do instead |
|---|---|---|
| Delete mail for good | Choice | Gmail's trash keeps mail for 30 days. A permanent delete cannot be undone, so the server never asks for the scope that allows it. `trash` and `untrash` are the tools. |
| A filter that forwards mail | Choice | Forwarding sends mail to another address, which Gmail only allows after that address is verified and a further scope is granted. Filters here set labels; one that sends mail to the trash or to spam needs `discard: true`. |
| Change a filter | API | Gmail has no filter update. Create the new filter, then delete the old one. |
| Get back a deleted draft, label or filter | API | Only mail has a trash. These are gone once deleted. |

## Documents (Docs)

| You want | Reason | Why, and what to do instead |
|---|---|---|
| A bullet list under a numbered list, each level with its own marker | API | `createParagraphBullets` takes one preset for the whole list and no request changes one level's glyph. A bullet under a number comes out as a sub-number. |
| A horizontal rule | API | No request inserts one. Markdown rules are dropped. |
| An image from markdown or from a local file | API, with a workaround | Docs inserts an image only from a URL it can fetch. In markdown an image becomes a link. `batch_update_document` takes local files in `images`: each goes to Drive, is shared by link for the seconds the batch takes, then unshared and trashed. |
| A suggestion (tracked change) | API | The API cannot create one. |
| A comment anchored to a passage | API | Comments made through the API are not tied to text in a Doc. |
| Anything Apps Script can do and the API cannot | API | Apps Script reaches some of these, with a project and a grant of its own. |

## Spreadsheets (Sheets)

| You want | Reason | Why, and what to do instead |
|---|---|---|
| A write that fails if someone else edited the sheet meanwhile | API | Sheets' API has no revision to pin a write to, unlike Docs and Slides. Rows someone inserts between a plan's read and its write shift under it. Keep the window between read and write short. |
| Insert columns on their own | Not built | `append_rows` and `upsert_rows` add rows where they belong. For anything else, `batch_update_spreadsheet` takes an `insertDimension` request. |
| An image in a cell | API | Sheets' API inserts no images. An `=IMAGE()` formula needs a link that stays public. |
| `read_doc` of a particular tab | API | Drive exports a Sheet as the CSV of its first tab, with no tab selector. `read_rows` reads any tab. |
| A request Google added after this server was built | Choice | Every batch is checked against Google's own description of the API (its Discovery document) before it is sent, so a typo never reaches Google. The copy is vendored, so a field Google added later is refused, with the revision named, until `npx tsx scripts/refresh-discovery.ts` refreshes it. |

## Presentations (Slides)

| You want | Reason | Why, and what to do instead |
|---|---|---|
| Animations | API | The API has no request for them. |
| A template made by hand, copied by an account that has only the Docs, Sheets and Slides grant | API | With the `drive.file` scope Drive lets the client copy only files it created or opened. Run that account on Drive's grant (`GOOGLE_EDITORS_DRIVE_ACCOUNT`). |

## Drive

| You want | Reason | Why, and what to do instead |
|---|---|---|
| Delete a file for good | Choice | Same as mail: Drive's trash keeps a file for 30 days and a permanent delete cannot be undone. |
| Drive tools for every account | Choice | The Drive tools hold one grant, for the one account's Drive you choose in setup. Other accounts reach their files through the Docs, Sheets, Slides, comments and sharing tools. |
| Two files of one name in one folder, through this server | Choice | `move_file` refuses to make two objects of one name in a folder, since a path would then name two files. |

## Tasks, contacts and Meet

| You want | Reason | Why, and what to do instead |
|---|---|---|
| Delete a task | Not built | Mark it done with `complete_task`. |
| Move a repeating task to another list | API | Google refuses it. |
| A time of day on a task's due date | API | Google Tasks keeps the date and drops the time. |
| A Workspace directory on a personal account | API | Only Workspace accounts have one. `find_people` lists it under `unavailable`, which means "could not look", never "nobody". |
| Meet records older than 30 days | API | Meet keeps them for 30 days. It shows only meetings the account took part in or organised, and transcripts or smart notes only where the meeting turned them on, which needs Workspace. |

## Other Google products

Chat, Classroom, Forms and Apps Script have no counterpart here. Google
publishes its own servers for Chat and Classroom (below).

## Compared with Google's own Workspace MCP servers

Google publishes remote MCP servers for Gmail, Drive, Docs, Sheets, Slides,
Calendar, Chat, People and Classroom, as a developer preview with one OAuth
connection each ([overview](https://developers.google.com/workspace/guides/configure-mcp-servers);
the list was last read on 2026-10-18). This section compares their Docs,
Sheets, Slides, Drive and Calendar tools with this server's, as read in
September 2026 from the reference under each heading. Gmail is compared in the
[README](../README.md#other-servers-for-google-workspace). People is not
compared here, though `find_people` covers its contact and directory search.

Two differences hold for every product:

- **Accounts.** A Google connector holds one account, and connecting a second
  replaces the first. Here every tool takes `account`, and the reads that make
  sense across accounts (agenda, free/busy, mail search) read them all in one
  call.
- **Operations, and a checked full API.** Google's Docs, Sheets and Slides
  servers read the whole JSON and send a raw `batchUpdate`, leaving UTF-16
  indices, grid coordinates and object ids to the model. Here, operations do
  that arithmetic in tested code (replace a section, upsert rows by key, build
  a deck from an outline). Each API's full `batchUpdate` is here too, with a
  structural read showing every index or id, text found as ranges, A1 for
  Sheets' coordinates, every request checked against the API's schema before
  it is sent, and Docs batches that name an index pinned to their revision.

### Docs ([reference](https://developers.google.com/workspace/docs/api/reference/mcp))

| Google | Here | How they compare |
|---|---|---|
| `read_doc`: the document's JSON | `read_document`: markdown, an index of sections (heading id and path), one section on request, and the revisionId | Same content in another form. Markdown costs a fraction of the tokens and is what a model writes back. |
| `read_doc` (the JSON) | `get_document`: the structure with every index, every tab, short styles, a table's shared cell style once; `format: "raw"` with a field mask for the JSON itself | Same content in a fraction of the characters, with `find_in_document` to turn text into ranges. |
| `update_doc`: any `documents.batchUpdate` | `batch_update_document`: any request, checked against the API's schema first, pinned to a revision when it names an index; and `edit_document_section`, `append_to_document`, `create_document` for markdown | Same reach, checked. |

### Sheets ([reference](https://developers.google.com/workspace/sheets/api/reference/mcp))

| Google | Here | How they compare |
|---|---|---|
| `get_spreadsheet` | `list_sheets` | Same metadata; grid data is `read_rows`'. |
| `get_values` | `read_rows` | Same cells, typed: rows keyed by the header, dates as ISO strings, currency as `{value, amount, formatted}` with the exact decimal string. Google's returns arrays of display strings or bare numbers. |
| `update_values`, `update_formulas` | `write_range` | One tool for both, entered as if typed (USER_ENTERED), so a formula and a value are the same call. |
| `insert_dimension` | inside `append_rows` and `upsert_rows` | Rows are added where they go, in the same atomic batch. No standalone tool, and inserting columns is not here. |
| `update_spreadsheet`: any of 70+ requests | `batch_update_spreadsheet`: any request, checked against the API's schema first, A1 accepted where a GridRange, GridCoordinate or DimensionRange goes; and `format_range`, `add_chart`, `append_rows`, `upsert_rows` as operations | Same reach, checked. |
| (none) | `get_spreadsheet` | Here only: every sheet's ids, merges, conditional formats, filters, protected and banded ranges, charts, tables and groups as A1; or raw, with grid data. |
| (none) | `get_values`, `update_values`, `clear_values`, `append_values`, `copy_sheet_to` | Here only: the values API in full, and a sheet copied between spreadsheets. |
| (none: Drive's `create_file`) | `create_spreadsheet` | Here only: named sheets with bold, frozen header rows, straight into a folder. |

`upsert_rows` has no Google equivalent: there it takes a read, an
`insert_dimension` and `update_values` calls that are not atomic, with the key
matching left to the model.

### Slides ([reference](https://developers.google.com/workspace/slides/api/reference/mcp))

| Google | Here | How they compare |
|---|---|---|
| `read_presentation`: the deck's JSON | `read_deck` (text and speaker notes per slide), `list_layouts` (layouts and their placeholders) | Same content, reduced to what a model reads. |
| `read_presentation` (the JSON) | `get_presentation`: every slide's elements with ids, size, transform and exact text; raw with a field mask | Same content, smaller. |
| `update_presentation`: any batchUpdate | `batch_update_presentation`: any request, checked against the API's schema first; and `create_deck_from_outline`, `fill_placeholders` as operations | Same reach, checked. |
| (none) | `get_thumbnails` | Here only: a PNG per slide, to look at what was made. |

### Drive ([reference](https://developers.google.com/workspace/drive/api/reference/mcp))

| Google | Here | How they compare |
|---|---|---|
| `search_files` | `find_files` | Same. |
| `get_file_metadata` | `describe_file` | Same. |
| `read_file_content` | `read_doc` | Same for Docs, Sheets and Slides (exported as text, markdown or HTML). Binary files are refused here: `download_file` saves their bytes. |
| `list_recent_files` | `find_files` with `modified_after` | Covered. |
| `copy_file` | `copy_file` | Same, for one file into an existing folder; refuses a name already there. |
| `create_file` | `upload_file`, and inside `create_document`, `create_spreadsheet`, `create_deck_from_outline` | Here the bytes go in by path or as checked base64, and Drive's own checksum of what it stored is compared with the source. |
| `download_file_content` | `download_file` | Here the file is saved to a folder and checked against Drive's checksum, rather than returned through the conversation. |
| `get_file_permissions` | `list_permissions`, with `share_file`, `update_permission`, `remove_permission` to change them | Same, and more: Google's server only reads. |
| (none) | `list_comments`, `add_comment`, `reply_to_comment`, `edit_comment`, `delete_comment` | Here only: comment threads on any file, resolved and reopened. |
| (none) | `list_revisions`, `download_revision`, `update_revision` | Here only: a file's history, an old revision saved, kept or published. |
| (none) | `list_folder`, `resolve_path`, `path_of`, `move_file`, `rename_file`, `create_folder`, `trash_file`, `untrash_file`, `start_drive_cursor`, `drive_changes` | Here only. Google's Drive server cannot move, rename or trash a file, make a folder, or report what changed. |

### Calendar ([reference](https://developers.google.com/workspace/calendar/api/v3/reference/mcp))

| Google | Here | How they compare |
|---|---|---|
| `list_events`, `search_events` | `agenda` (with `query`) | Same, across every account at once, with the conflicts between them and the invitations still unanswered. |
| `get_event`, `list_calendars`, `create_event`, `update_event`, `delete_event` | the same names | Same. |
| `respond_to_event` | `respond_to_invite` | Same. |
| `suggest_time` | `find_time`, `free_busy` | Same, across every account. |

Nothing of Google's Calendar server is missing here; this one adds every
other account.
