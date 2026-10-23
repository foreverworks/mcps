import { compact, type McpServer } from "@foreverworks/mcp-kit";
import { z } from "zod";

import type { Deps } from "../app/ports.js";
import { crashLog, listFeedback } from "../app/usecases/feedback.js";
import { health } from "../app/usecases/health.js";
import { replyToAppStoreReview, replyToPlayReview } from "../app/usecases/replies.js";
import { listAppStoreReviews, listPlayReviews } from "../app/usecases/reviews.js";
import { REPLY_MAX } from "../domain/reviews.js";
import { handled } from "./envelope.js";

const app = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .optional()
  .describe('The app: its bundle id ("com.example.app") or its Apple id (digits). Leave it out when the key sees one app (health lists them).');

const packageName = z.string().trim().min(1).max(200).optional().describe('The Play package, e.g. "com.example.app". Leave it out when the server answers for one (health lists them).');

const limit = (fallback: number, max: number) => z.number().int().min(1).max(max).default(fallback);

const cursor = z.string().trim().min(1).max(2000).optional().describe("nextCursor from the previous call, to read on.");

const reviewId = (what: string) => z.string().trim().min(1).max(200).describe(what);

const replace = z.boolean().default(false).describe("Put this reply in place of the review's existing one. Without it, a review that already has a different reply is refused.");

const LIST_APP_STORE = {
  app,
  rating: z.array(z.number().int().min(1).max(5)).min(1).max(5).optional().describe("Only these star ratings, e.g. [1, 2]."),
  territory: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, "a three-letter territory code, e.g. USA or ROU")
    .optional()
    .describe("Only reviews from this storefront: Apple's three-letter code, e.g. USA, ROU, GBR."),
  replied: z.boolean().optional().describe("true: only reviews with a published reply; false: only those without one."),
  sort: z.enum(["newest", "oldest", "highest", "lowest"]).default("newest"),
  limit: limit(20, 200),
  cursor,
};

const LIST_PLAY = {
  package: packageName,
  limit: limit(20, 100),
  cursor,
  translate_to: z
    .string()
    .trim()
    .regex(/^[a-z]{2,3}([_-][A-Za-z]{2,4})?$/, "a language code, e.g. en or ro")
    .optional()
    .describe('Have Google translate each review into this language, e.g. "en".'),
};

const FEEDBACK = {
  app,
  kind: z.enum(["crash", "screenshot"]).optional().describe("Only crash feedback or only screenshot feedback. Default: both, merged newest first (page through one kind with its cursor)."),
  limit: limit(20, 100),
  cursor: cursor.describe("nextCursor from the previous call of the same kind."),
};

const CRASH_LOG = { submission: reviewId("A crash feedback's id, from list_testflight_feedback.") };

const REPLY_APP_STORE = {
  review: reviewId("The review's id, from list_app_store_reviews."),
  text: z.string().min(1).max(REPLY_MAX.app_store).describe(`The reply, at most ${REPLY_MAX.app_store} characters.`),
  replace,
};

const REPLY_PLAY = {
  package: packageName,
  review: reviewId("The review's id, from list_play_reviews."),
  text: z.string().min(1).max(REPLY_MAX.play).describe(`The reply, at most ${REPLY_MAX.play} characters (Google's limit).`),
  replace,
};

type ArgsOf<S extends z.ZodRawShape> = z.infer<z.ZodObject<S>>;

/** The whole tool surface. */
export const registerAll = (server: McpServer, deps: Deps): void => {
  server.registerTool(
    "health",
    {
      title: "Health",
      description:
        "Whether each store's credentials work, and what they reach: the apps the App Store Connect key sees (their bundle ids and Apple ids), " +
        "and each Play package this server answers for, with one review read. A store without credentials is reported as not configured.",
      inputSchema: {},
    },
    handled(() => health(deps)),
  );

  server.registerTool(
    "list_app_store_reviews",
    {
      title: "List App Store reviews",
      description:
        "An app's App Store reviews, newest first unless sorted otherwise: rating, title, text, the reviewer's nickname, the storefront, the date, " +
        "and the developer's reply with its state (pending until Apple publishes it). Filter by star rating, storefront or whether it has a reply.",
      inputSchema: LIST_APP_STORE,
    },
    handled((a: ArgsOf<typeof LIST_APP_STORE>) =>
      listAppStoreReviews(deps, { sort: a.sort, limit: a.limit, ...compact({ app: a.app, ratings: a.rating, territory: a.territory, replied: a.replied, cursor: a.cursor }) }),
    ),
  );

  server.registerTool(
    "list_play_reviews",
    {
      title: "List Google Play reviews",
      description:
        "A package's Google Play reviews with text, newest first: rating, text, author, language, app version, device, the date, and the " +
        "developer's reply. Google's API returns only reviews written or changed in the last 7 days; older ones are in Play Console's reports.",
      inputSchema: LIST_PLAY,
    },
    handled((a: ArgsOf<typeof LIST_PLAY>) => listPlayReviews(deps, { limit: a.limit, ...compact({ package: a.package, cursor: a.cursor, translateTo: a.translate_to }) })),
  );

  server.registerTool(
    "list_testflight_feedback",
    {
      title: "List TestFlight feedback",
      description:
        "What testers sent from the TestFlight app, newest first: screenshot feedback (comment and screenshots, at URLs that expire) and crash " +
        "feedback (comment; get_testflight_crash_log reads the log), each with the tester's e-mail, device, OS and the build number.",
      inputSchema: FEEDBACK,
    },
    handled((a: ArgsOf<typeof FEEDBACK>) => listFeedback(deps, { limit: a.limit, ...compact({ app: a.app, kind: a.kind, cursor: a.cursor }) })),
  );

  server.registerTool(
    "get_testflight_crash_log",
    {
      title: "Get a TestFlight crash log",
      description: "A crash feedback's crash log, saved whole to the server's outbox: the answer gives the file's path, SHA-256 and size, and its first 40 lines.",
      inputSchema: CRASH_LOG,
    },
    handled((a: ArgsOf<typeof CRASH_LOG>) => crashLog(deps, a)),
  );

  server.registerTool(
    "reply_app_store_review",
    {
      title: "Reply to an App Store review",
      description:
        "Publish a reply under an App Store review, in the developer's name and visible to everyone once Apple publishes it: send only text the " +
        "user approved for this review. A review that already has a different reply is refused unless replace is true; the same text again sends nothing.",
      inputSchema: REPLY_APP_STORE,
    },
    handled((a: ArgsOf<typeof REPLY_APP_STORE>) => replyToAppStoreReview(deps, a)),
  );

  server.registerTool(
    "reply_play_review",
    {
      title: "Reply to a Google Play review",
      description:
        "Publish a reply under a Google Play review, in the developer's name and visible to everyone: send only text the user approved for this " +
        "review. A review that already has a different reply is refused unless replace is true; the same text again sends nothing.",
      inputSchema: REPLY_PLAY,
    },
    handled((a: ArgsOf<typeof REPLY_PLAY>) => replyToPlayReview(deps, { review: a.review, text: a.text, replace: a.replace, ...compact({ package: a.package }) })),
  );
};
