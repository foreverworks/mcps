import { compact } from "@foreverworks/mcp-kit";

import type { RawBlock } from "./schema.js";
import { plainText } from "./text.js";

/**
 * A block as read_blocks shows it: its id, its type and the text a person
 * reads in it. Colours and annotations stay behind, as in models.ts.
 *
 * An AI meeting-notes block holds no text of its own: it names the three
 * blocks that hold its summary, its notes and its transcript, and those are
 * read by id in turn. A block the API cannot show still says what Notion calls
 * it, under `unsupported`.
 */

export type MeetingNotes = {
  readonly title?: string;
  readonly status?: string;
  readonly summaryBlockId?: string;
  readonly notesBlockId?: string;
  readonly transcriptBlockId?: string;
  readonly recording?: { readonly start?: string; readonly end?: string };
  readonly calendarEvent?: { readonly start: string; readonly end: string };
};

export type Block = {
  readonly id: string;
  readonly type: string;
  readonly text?: string;
  readonly url?: string;
  /** A to-do's box. */
  readonly checked?: boolean;
  /** Set only when true: read those with this block's id. */
  readonly hasChildren?: true;
  readonly meetingNotes?: MeetingNotes;
  /** Notion's name for a block type the API does not support. */
  readonly unsupported?: string;
};

/** The text a block shows, for the types that hold any. */
const textOf = (b: RawBlock): string | undefined => {
  switch (b.type) {
    case "paragraph":
      return plainText(b.paragraph.rich_text);
    case "heading_1":
      return plainText(b.heading_1.rich_text);
    case "heading_2":
      return plainText(b.heading_2.rich_text);
    case "heading_3":
      return plainText(b.heading_3.rich_text);
    case "heading_4":
      return plainText(b.heading_4.rich_text);
    case "bulleted_list_item":
      return plainText(b.bulleted_list_item.rich_text);
    case "numbered_list_item":
      return plainText(b.numbered_list_item.rich_text);
    case "quote":
      return plainText(b.quote.rich_text);
    case "to_do":
      return plainText(b.to_do.rich_text);
    case "toggle":
      return plainText(b.toggle.rich_text);
    case "callout":
      return plainText(b.callout.rich_text);
    case "code":
      return plainText(b.code.rich_text);
    case "child_page":
      return b.child_page.title;
    case "child_database":
      return b.child_database.title;
    case "equation":
      return b.equation.expression;
    default:
      return undefined;
  }
};

const meetingNotesOf = (b: RawBlock): MeetingNotes | undefined => {
  if (b.type !== "meeting_notes") return undefined;
  const m = b.meeting_notes;
  const recording = m.recording === null || m.recording === undefined ? undefined : compact({ start: m.recording.start_time ?? undefined, end: m.recording.end_time ?? undefined });
  return compact({
    title: m.title === null || m.title === undefined ? undefined : plainText(m.title),
    status: m.status ?? undefined,
    summaryBlockId: m.children?.summary_block_id ?? undefined,
    notesBlockId: m.children?.notes_block_id ?? undefined,
    transcriptBlockId: m.children?.transcript_block_id ?? undefined,
    recording: recording === undefined || Object.keys(recording).length === 0 ? undefined : recording,
    calendarEvent: m.calendar_event === null || m.calendar_event === undefined ? undefined : { start: m.calendar_event.start_time, end: m.calendar_event.end_time },
  });
};

export const toBlock = (b: RawBlock): Block => {
  const text = textOf(b);
  return compact({
    id: b.id,
    type: b.type,
    url: b.type === "bookmark" ? b.bookmark.url : b.type === "embed" ? b.embed.url : b.type === "link_preview" ? b.link_preview.url : undefined,
    text: text === "" ? undefined : text,
    checked: b.type === "to_do" ? b.to_do.checked : undefined,
    hasChildren: b.has_children ? (true as const) : undefined,
    meetingNotes: meetingNotesOf(b),
    unsupported: b.type === "unsupported" ? b.unsupported.block_type : undefined,
  });
};
