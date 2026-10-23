# This server and Google's own Workspace MCP servers

Google publishes remote MCP servers for Gmail, Drive, Docs, Sheets, Slides,
Calendar, Chat, People and Classroom, as a developer preview with one OAuth
connection each ([overview](https://developers.google.com/workspace/guides/configure-mcp-servers);
list re-read on 2026-10-18). This page compares their Docs, Sheets, Slides,
Drive and Calendar tools with this server's, as read in September 2026 from
the reference under each heading. Gmail is compared in the
[README](../README.md#other-servers-for-google-workspace). People is not
compared here, though `find_people` covers its contact and directory search;
Chat and Classroom have no counterpart here.

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

## Docs ([reference](https://developers.google.com/workspace/docs/api/reference/mcp))

| Google | Here | How they compare |
|---|---|---|
| `read_doc`: the document's JSON | `read_document`: markdown, an index of sections (heading id and path), one section on request, and the revisionId | Same content in another form. Markdown costs a fraction of the tokens and is what a model writes back. |
| `read_doc` (the JSON) | `get_document`: the structure with every index, every tab, short styles, a table's shared cell style once; `format: "raw"` with a field mask for the JSON itself | Same content in a fraction of the characters, with `find_in_document` to turn text into ranges. |
| `update_doc`: any `documents.batchUpdate` | `batch_update_document`: any request, checked against the API's schema first, pinned to a revision when it names an index; and `edit_document_section`, `append_to_document`, `create_document` for markdown | Same reach, checked. |

Not here, on purpose or not yet:

- **Mixed list glyphs.** A bullet under a number comes out as a sub-number:
  `createParagraphBullets` sets one preset for every level, and no request
  changes one level's glyph.
- **Horizontal rules and images from markdown.** No request inserts a rule,
  and an image needs a URL Google can fetch, so a rule is dropped and an image
  becomes a link.

## Sheets ([reference](https://developers.google.com/workspace/sheets/api/reference/mcp))

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

## Slides ([reference](https://developers.google.com/workspace/slides/api/reference/mcp))

| Google | Here | How they compare |
|---|---|---|
| `read_presentation`: the deck's JSON | `read_deck` (text and speaker notes per slide), `list_layouts` (layouts and their placeholders) | Same content, reduced to what a model reads. |
| `read_presentation` (the JSON) | `get_presentation`: every slide's elements with ids, size, transform and exact text; raw with a field mask | Same content, smaller. |
| `update_presentation`: any batchUpdate | `batch_update_presentation`: any request, checked against the API's schema first; and `create_deck_from_outline`, `fill_placeholders` as operations | Same reach, checked. |
| (none) | `get_thumbnails` | Here only: a PNG per slide, to look at what was made. |

## Drive ([reference](https://developers.google.com/workspace/drive/api/reference/mcp))

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

## Calendar ([reference](https://developers.google.com/workspace/calendar/api/v3/reference/mcp))

| Google | Here | How they compare |
|---|---|---|
| `list_events`, `search_events` | `agenda` (with `query`) | Same, across every account at once, with the conflicts between them and the invitations still unanswered. |
| `get_event`, `list_calendars`, `create_event`, `update_event`, `delete_event` | the same names | Same. |
| `respond_to_event` | `respond_to_invite` | Same. |
| `suggest_time` | `find_time`, `free_busy` | Same, across every account. |

Nothing of Google's Calendar server is missing here; this one adds every
other account.
