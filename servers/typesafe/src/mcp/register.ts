import type { McpServer } from "@foreverworks/mcp-kit";
import { z } from "zod";

import type { Deps } from "../app/ports.js";
import { ask, askBatch } from "../app/usecases/ask.js";
import { checkHealth } from "../app/usecases/health.js";
import { MAX_BATCH_ITEMS, MAX_UNNAMED_ROWS } from "../domain/batchFile.js";
import type { Questions, State } from "../domain/schema.js";
import { VERDICTS } from "../domain/verdicts.js";
import { handled } from "./envelope.js";

/** Text, a JSON object or array, or null: what TypeSafe accepts as state, instructions and criteria. */
const entry = z.union([z.string(), z.record(z.string(), z.unknown()), z.array(z.unknown()), z.null()]);

const instructions = entry.describe(
  "The judgment, stated in full (question ids never reach the model). An object may hold the question in one field and data it refers to in others, pointed at in backticks.",
);

const question = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("noul"),
      instructions,
      criteria: z
        .object({ true: entry.optional(), false: entry.optional() })
        .optional()
        .describe("What a yes and a no mean, when the question alone leaves room."),
    })
    .describe("Yes/no: answered with the probability that the answer is yes."),
  z
    .object({
      type: z.literal("choice"),
      instructions,
      criteria: z
        .record(z.string(), entry)
        .refine((options) => Object.keys(options).length >= 2 && Object.keys(options).length <= 255, "a choice needs 2 to 255 options")
        .describe('Option -> what it means (null when the name says it all). Include a "none" option when nothing may fit.'),
    })
    .describe("One of a defined set: the pick, a probability per option, and a confidence."),
  z
    .object({
      type: z.literal("score"),
      instructions,
      criteria: z.array(entry).min(2).max(10).describe("Ordered levels, lowest first, each a concrete situation that stands on its own."),
    })
    .describe("A degree on your ordered levels: a probability-weighted value from 0 (can land between levels), per-level probabilities, a confidence."),
]);

const questions = z
  .record(z.string().min(1).max(100), question)
  .refine((q) => Object.keys(q).length > 0, "ask at least one question")
  .describe("Your question id -> question. Every independent judgment about the same state goes in one call: they run together and cannot see each other.");

/** An entry, less null: the API answers a null state as a missing one. */
const state = z.union([z.string(), z.record(z.string(), z.unknown()), z.array(z.unknown())]).describe(
  "What is judged: text, or JSON with named fields (a record, a thread, a posting with its metadata) the questions can point at, e.g. `posting.location`.",
);


const unit = z.number().min(0).max(1);

const thresholds = z
  .record(
    z.string().min(1).max(100),
    z.strictObject({
      act_above: unit.describe("Act on the answer when its certainty is above this."),
      review_above: unit.describe("Otherwise a person reviews it when its certainty is above this; below, abstain. At most act_above."),
    }),
  )
  .optional()
  .describe(
    "Question id -> thresholds: each row's answer to that question gets a verdict, act, review or abstain, taken on its certainty " +
      "(a noul's |p - 0.5| x 2, a choice's or a score's confidence, rounded down to three places). The reply echoes them and the summary counts the verdicts.",
  );

const verdict = z.enum(VERDICTS);
const condition = z.union([
  z.boolean().describe("A noul: true is a yes (p >= 0.7), false a no (p <= 0.3), as the summary counts them."),
  z.string().describe("A choice: its pick is this label."),
  z.array(z.string()).min(1).describe("A choice: its pick is one of these labels."),
  z
    .strictObject({
      is: z.union([z.boolean(), z.string(), z.array(z.string()).min(1)]).optional().describe("As the shorthands: true/false for a noul, labels for a choice."),
      min: z.number().optional().describe("The row's value at least this: a noul's p, a score, a choice's confidence."),
      max: z.number().optional().describe("The row's value at most this."),
      verdict: z.union([verdict, z.array(verdict).min(1)]).optional().describe("The question's verdict (it needs thresholds)."),
    })
    .describe("Every part given must hold."),
]);

const where = z
  .record(z.string().min(1).max(100), condition)
  .optional()
  .describe(
    'Question id -> condition; the reply lists only the answered rows meeting every one, and says how many matched. E.g. {"urgent": true, "team": ["billing"], "mood": {"min": 1.5}}. ' +
      "Checked against the questions before any request.",
  );

const top = z
  .strictObject({
    by: z.string().min(1).max(100).describe("A noul or score question id: rows are ranked by its p or its score."),
    k: z.number().int().min(1).max(MAX_BATCH_ITEMS).describe("How many rows to keep."),
  })
  .optional()
  .describe("Only the k rows (of those where keeps) with the highest value for one question, highest first.");

// The arguments arrived as JSON, so every entry is a JsonValue, and the schema above has checked
// each question's shape and level count; the SDK's types say the same thing more narrowly.
const asQuestions = (q: z.infer<typeof questions>): Questions => q as Questions;
const asState = (e: z.infer<typeof state>): State => e as State;

/** The whole tool surface. */
export const registerAll = (server: McpServer, deps: Deps): void => {
  const model = z.string().trim().min(1).max(100).describe(`A model from health. Default: the server's, ${deps.defaultModel}.`);
  const itemsFile = z
    .object({
      path: z.string().optional().describe(`A path: ${deps.readInput.where}. Links are refused.`),
      content_base64: z.string().optional().describe("The bytes as standard base64, only as a script that read the file wrote them, never typed. Needs sha256."),
      sha256: z.string().optional().describe("Hex SHA-256 of the source file, as sha256sum prints it. Required with content_base64, checked with path."),
    })
    .optional()
    .describe(
      `The rows as a UTF-8 file instead of items: JSONL, one {"id", "state"} object per line, or one JSON array of them; at most ${MAX_BATCH_ITEMS}, ` +
        `every row with an id above ${MAX_UNNAMED_ROWS}. ` +
        `The reply names its sha256 and size. ${deps.readInput.help}`,
    );

  server.registerTool(
    "health",
    {
      title: "Health",
      description:
        "Check that the TypeSafe API key is present and accepted, and list the models it can use. Run this before concluding the MCP is broken.",
      inputSchema: {},
    },
    handled(() => checkHealth(deps)),
  );

  server.registerTool(
    "ask",
    {
      title: "Ask Jev",
      description:
        "Ask TypeSafe's Jev, a System One model, typed questions about one state and get calibrated answers: a `noul` is the " +
        "probability that a yes/no statement holds, a `choice` picks one of your options with a probability each, a `score` " +
        "places the state on your ordered levels. Jev writes no text and does no multi-step reasoning: use it for fast, narrow " +
        "judgments (routing, triage, relevance, a policy check) whose probabilities you then threshold. One narrow judgment per " +
        "question; a no-match option where nothing may fit. A probability near 0.5 means undecided, not medium. About 0.5 s a call.",
      inputSchema: { state, questions, model: model.optional() },
    },
    handled((a) => ask(deps, { state: asState(a.state), questions: asQuestions(a.questions), model: a.model })),
  );

  server.registerTool(
    "ask_batch",
    {
      title: "Ask Jev over many states",
      description:
        `The same questions over up to ${MAX_BATCH_ITEMS} states, several requests at a time: triage postings, transactions, emails or passages ` +
        "without reading them all yourself. Replies with a summary per question (choice: counts; noul: mean and how many are " +
        ">= 0.7 and <= 0.3; score: mean, min, max) and each row's compact answers (a noul's probability, a choice's pick and " +
        "confidence, a score and its confidence). For a large batch pass list 'none' or 'failed' with save true: every row's full " +
        "answers go to a JSONL file in the outbox and the reply names it with its sha256 and size. A row that fails is reported and " +
        "the rest go on. Rows already in a file go as items_file, not typed into items: that keeps them out of your context and " +
        "exactly as written. thresholds turn each answer into act, review or abstain; where lists only the rows that meet conditions, " +
        "top only the k highest by a question, and counts tallies the answers (and verdicts) of the rows where keeps: over a large batch " +
        "they keep the reply to the rows that matter. A client that asks for progress hears the rows done; cancelling stops the rows not yet asked.",
      inputSchema: {
        items: z
          .array(
            z.object({
              id: z
                .string()
                .min(1)
                .max(200)
                .optional()
                .describe(`Names the row in the answer. Default: its index, allowed only up to ${MAX_UNNAMED_ROWS} rows.`),
              state,
            }),
          )
          .min(1)
          .max(MAX_BATCH_ITEMS)
          .optional()
          .describe("The rows, typed into the call. Give items or items_file."),
        items_file: itemsFile,
        questions,
        model: model.optional(),
        concurrency: z.number().int().min(1).max(16).default(8).describe("Requests in flight at once."),
        probabilities: z.boolean().default(false).describe("Also list each row's full distribution per choice and score."),
        list: z.enum(["all", "failed", "none"]).default("all").describe("Which rows the reply lists; the summary always covers every row."),
        save: z.boolean().default(false).describe("Also write every row's full answers to the outbox as JSONL."),
        thresholds,
        where,
        top,
        counts: z.boolean().default(false).describe("Also tally each question's answers (a noul's yes/no/between, a choice's picks, a score's nearest levels) and verdicts over the rows where keeps."),
      },
    },
    handled((a) =>
      askBatch(deps, {
        items: a.items?.map((item) => ({ id: item.id, state: asState(item.state) })),
        itemsFile: a.items_file && { path: a.items_file.path, contentBase64: a.items_file.content_base64, sha256: a.items_file.sha256 },
        questions: asQuestions(a.questions),
        model: a.model,
        concurrency: a.concurrency,
        probabilities: a.probabilities,
        list: a.list,
        save: a.save,
        thresholds: a.thresholds,
        where: a.where && Object.fromEntries(Object.entries(a.where).map(([id, c]) => [id, typeof c === "object" && !Array.isArray(c) ? c : { is: c }])),
        top: a.top,
        counts: a.counts,
      }),
    ),
  );
};
