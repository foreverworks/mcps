import type { McpServer, OutputOf } from "@foreverworks/mcp-kit";
import { z } from "zod";

import type { Deps } from "../app/ports.js";
import { getMark } from "../app/usecases/getMark.js";
import { downloadDocuments, markDocuments, markHistory } from "../app/usecases/records.js";
import { checkHealth } from "../app/usecases/health.js";
import { searchMarks } from "../app/usecases/search.js";
import { MATCH_MODES, OFFICES, STATUS_FILTERS } from "../domain/mark.js";
import { handled } from "./envelope.js";
import { DOCUMENTS_OUTPUT, DOWNLOAD_OUTPUT, HEALTH_OUTPUT, HISTORY_OUTPUT, MARK_OUTPUT, SEARCH_OUTPUT } from "./outputs.js";

const office = z.enum(OFFICES);

/** The whole tool surface. */
export const registerAll = (server: McpServer, deps: Deps): void => {
  server.registerTool(
    "health",
    {
      title: "Health",
      description:
        "Which trademark registers this server can search right now: each source's state (ok, not_configured with what it needs, pending while the register approves access, failing), " +
        "whether it is an official API, what `similar` means there, and the offices it cannot search with the reason. Run this before concluding the MCP is broken.",
      inputSchema: {},
      outputSchema: HEALTH_OUTPUT,
    },
    handled((): Promise<OutputOf<typeof HEALTH_OUTPUT>> => checkHealth(deps)),
  );

  server.registerTool(
    "search_marks",
    {
      title: "Search trademark registers for a name",
      description:
        "Is a name already a registered or pending trade mark? Searches one name in each office at once and answers per office: " +
        "the marks found, closest first (identical, then containing the name, then similar, the most alike first), each with its " +
        "status (registered, pending, dead), owners, Nice classes, filing date, a link to the office's page and a similarity score " +
        "from 0 to 100 computed here the same way for every office (spelling and sound), plus counts per relation; goods narrows " +
        "to marks whose goods and services hold given words. " +
        "US is USPTO's register, EM the EU register (EUTMs and international registrations designating the EU). An office that " +
        "was not searched (no source, no credentials, a failure) says so and why: never read it as clear. Not legal advice: a " +
        "conflict also depends on goods and services, and no score settles similarity.",
      inputSchema: {
        name: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .refine((s) => !s.includes("*"), "a name, not a pattern: leave out *")
          .describe(
            'The name as it would be written. Case, accents, spaces and punctuation do not make two marks different, but a register finds ' +
              'by words: search a compound spaced too ("Blue Night" also finds BLUENIGHT at USPTO; "Bluenight" misses BLUE NIGHT).',
          ),
        offices: z.array(office).max(OFFICES.length).optional().describe("EM (EUIPO), US (USPTO), RO (OSIM), WO (WIPO). Default: all of them."),
        classes: z
          .array(z.number().int().min(1).max(45))
          .max(45)
          .optional()
          .describe("Nice classes, e.g. [9, 42] for software and SaaS. Default: every class."),
        goods: z
          .string()
          .trim()
          .min(2)
          .max(200)
          .optional()
          .describe(
            'Words that must appear together in a mark\'s goods and services, e.g. "computer software" or "mobile application". Applied where the ' +
              'office\'s source can (US); an office that cannot says goods_filter: unsupported and lists its marks unfiltered.',
          ),
        match: z
          .enum(MATCH_MODES)
          .default("similar")
          .describe("exact: the mark is the name. word: it contains the name. similar (default): also what sounds alike or is a letter off, where the office's source can tell."),
        status: z.enum(STATUS_FILTERS).default("live").describe("live (default): registered and pending marks only. all: dead ones too."),
        limit: z.number().int().min(1).max(100).default(20).describe("Marks listed per office; the counts cover every candidate examined."),
      },
      outputSchema: SEARCH_OUTPUT,
    },
    handled((a): Promise<OutputOf<typeof SEARCH_OUTPUT>> =>
      searchMarks(deps, {
        name: a.name,
        offices: a.offices ?? [],
        classes: [...new Set(a.classes ?? [])].sort((x, y) => x - y),
        goods: a.goods,
        match: a.match,
        status: a.status,
        limit: a.limit,
      }),
    ),
  );

  server.registerTool(
    "get_mark",
    {
      title: "One trade mark's details",
      description:
        "One mark by its office and number (as search_marks lists it): status, owners, every class with its goods and services " +
        "(each cut at 600 characters), the dates the office publishes (filing and registration from both; the status date and expiry from EUIPO only, " +
        "USPTO's search gives neither), and the office's page.",
      inputSchema: {
        office: office.describe("US or EM."),
        id: z.string().trim().min(1).max(20).describe("The office's number: a USPTO serial number (8 digits), an EUIPO application number (9, leading zeros included)."),
      },
      outputSchema: MARK_OUTPUT,
    },
    handled((a): Promise<OutputOf<typeof MARK_OUTPUT>> => getMark(deps, a.office, a.id)),
  );

  const serial = z.string().trim().min(1).max(20).describe("The USPTO serial number (8 digits), as search_marks lists it.");
  const usOffice = office.describe("US: case files come from USPTO's TSDR; other offices say where to read them.");

  server.registerTool(
    "mark_history",
    {
      title: "A mark's status history",
      description:
        "Where a US mark stands and every step its file records, newest first (filed, examined, office actions, published, " +
        "opposed, registered, renewed, abandoned), each with its date and USPTO's code, from USPTO's official TSDR API. Also the " +
        "status in USPTO's own words with its date and code, and the filing, registration, renewal and abandonment dates.",
      inputSchema: { office: usOffice, id: serial },
      outputSchema: HISTORY_OUTPUT,
    },
    handled((a): Promise<OutputOf<typeof HISTORY_OUTPUT>> => markHistory(deps, a.office, a.id)),
  );

  server.registerTool(
    "mark_documents",
    {
      title: "A mark's documents",
      description:
        "The documents in a US mark's file, newest first: each one's date, type code and description (an office action, a " +
        "specimen, a registration certificate), whether it came in or went out, and its pages, from USPTO's TSDR. " +
        "download_mark_documents saves the ones picked by type and date.",
      inputSchema: { office: usOffice, id: serial },
      outputSchema: DOCUMENTS_OUTPUT,
    },
    handled((a): Promise<OutputOf<typeof DOCUMENTS_OUTPUT>> => markDocuments(deps, a.office, a.id)),
  );

  const day = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "a date, YYYY-MM-DD");
  server.registerTool(
    "download_mark_documents",
    {
      title: "Save a mark's documents as a PDF",
      description:
        "Saves the documents of a US mark's file that a type code (from mark_documents) and a date window pick, as one PDF " +
        "in the server's outbox, and answers its path, SHA-256 and size. Without a filter it is the whole file, which for an " +
        "old mark runs to hundreds of pages. USPTO allows 4 of these a minute.",
      inputSchema: {
        office: usOffice,
        id: serial,
        type: z.string().trim().regex(/^[A-Za-z0-9]{2,6}$/, "a type code like OOA or SPE").optional().describe('A document type code from mark_documents, e.g. "OOA" (an office action).'),
        from: day.optional().describe("Only documents dated on or after this day."),
        to: day.optional().describe("Only documents dated on or before this day."),
      },
      outputSchema: DOWNLOAD_OUTPUT,
    },
    handled((a): Promise<OutputOf<typeof DOWNLOAD_OUTPUT>> => downloadDocuments(deps, a.office, a.id, { type: a.type, from: a.from, to: a.to })),
  );
};
