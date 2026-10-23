import { z } from "zod";

import { MATCH_MODES, OFFICES, STATUS_FILTERS } from "../domain/mark.js";

/**
 * What each tool answers, as MCP output schemas: a client gets the result as
 * typed structured content beside the JSON text, and the guard fails a result
 * that does not match (packages/mcp-kit, serve/guard.ts). Text an office
 * supplies (dates, numbers, its status words) is typed as text, not held to a
 * format here: the source adapters own those checks, and a register's odd date
 * must not turn a good answer into a failure. The controllers declare their
 * results as these types (the kit's OutputOf), so a use case that stops filling
 * a field fails the typecheck.
 */

const office = z.enum(OFFICES);
const count = z.number().int().min(0);

const markFields = {
  office,
  id: z.string(),
  mark: z.string().nullable(),
  status: z.enum(["registered", "pending", "dead"]),
  statusText: z.string(),
  owners: z.array(z.string()),
  classes: z.array(z.number().int()),
  kind: z.string().optional(),
  filed: z.string().optional(),
  registered: z.string().optional(),
  registrationNumber: z.string().optional(),
  translation: z.string().optional(),
  link: z.string(),
};

const { office: _office, ...listedFields } = markFields;
const listedMark = z.strictObject({
  ...listedFields,
  relation: z.enum(["identical", "contains", "similar"]),
  similarity: z
    .number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .describe("0 to 100, how alike the whole marks are written and sound, computed the same way for every office; absent for a mark with no words"),
});
const failure = z.strictObject({ kind: z.string(), message: z.string(), remedy: z.string() });

const searchedOffice = z.strictObject({
  office,
  source: z.string(),
  searched: z.literal(true),
  found: count,
  examined: count,
  more: z.literal(true).optional(),
  goods_filter: z.enum(["applied", "unsupported"]).optional().describe("Whether this office's marks were filtered by the goods asked for; unsupported: listed unfiltered"),
  counts: z.strictObject({ identical: count, contains: count, similar: count }),
  marks: z.array(listedMark),
});
const uncoveredOffice = z.strictObject({ office, searched: z.literal(false), reason: z.string() });
const failedOffice = z.strictObject({ office, source: z.string(), searched: z.literal(false), error: failure });

export const SEARCH_OUTPUT = z.strictObject({
  name: z.string(),
  match: z.enum(MATCH_MODES),
  status: z.enum(STATUS_FILTERS),
  classes: z.array(z.number().int()).optional(),
  goods: z.string().optional(),
  offices: z.array(z.union([searchedOffice, uncoveredOffice, failedOffice])),
});

export const MARK_OUTPUT = z.strictObject({
  source: z.string(),
  ...markFields,
  goodsAndServices: z.array(z.strictObject({ class: z.number().int(), cancelled: z.literal(true).optional(), terms: z.string() })),
  expires: z.string().optional(),
  statusDate: z.string().optional(),
});

const states = <A extends z.ZodRawShape>(about: A) =>
  z.union([
    z.strictObject({ ...about, state: z.literal("ok"), ms: z.number() }),
    z.strictObject({ ...about, state: z.enum(["not_configured", "pending"]), reason: z.string(), remedy: z.string() }),
    z.strictObject({ ...about, state: z.literal("failing"), error: z.strictObject({ kind: z.string(), message: z.string() }), remedy: z.string() }),
  ]);

const about = { office, source: z.string(), official: z.boolean(), similar: z.string(), goods_filter: z.boolean().describe("Whether search_marks' goods filter applies here") };

export const HEALTH_OUTPUT = z.strictObject({
  ok: z.boolean(),
  sources: z.array(states(about)),
  records: z.array(states({ office, source: z.string(), official: z.boolean() })).describe("The sources of status histories and documents"),
  uncovered: z.array(z.strictObject({ office, reason: z.string() })),
});

export const HISTORY_OUTPUT = z.strictObject({
  source: z.string(),
  office,
  id: z.string(),
  mark: z.string().nullable(),
  status: z.enum(["registered", "pending", "dead"]),
  statusText: z.string().describe("The office's own sentence for where the mark stands"),
  statusCode: z.number().int(),
  statusDate: z.string().optional(),
  category: z.string().optional().describe("The office's summary, e.g. LIVE/REGISTRATION/Issued and Active"),
  filed: z.string().optional(),
  registered: z.string().optional(),
  registrationNumber: z.string().optional(),
  renewed: z.string().optional(),
  abandoned: z.string().optional(),
  events: z.array(z.strictObject({ date: z.string(), code: z.string(), description: z.string(), number: z.number().int() })).describe("Every step the file records, newest first"),
  link: z.string(),
});

export const DOCUMENTS_OUTPUT = z.strictObject({
  source: z.string(),
  office,
  id: z.string(),
  count,
  documents: z.array(
    z.strictObject({
      date: z.string(),
      type: z.string().describe("The office's type code; download_mark_documents filters on it"),
      description: z.string(),
      category: z.string().describe("incoming (filed with the office) or outgoing (sent by it)"),
      pages: z.number().int().optional(),
    }),
  ),
});

export const DOWNLOAD_OUTPUT = z.strictObject({
  source: z.string(),
  office,
  id: z.string(),
  type: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  path: z.string().describe("The PDF in the server's outbox"),
  sha256: z.string(),
  size: z.number().int(),
});
