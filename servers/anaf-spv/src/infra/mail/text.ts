import type { CodeWatch } from "../../app/ports.js";
import { codesIn, firstNewCode } from "../../domain/codes.js";
import { configError, fail } from "../../domain/errors.js";
import { type Answer, type Connection, fillTemplate, succeeded, type ToolInfo } from "../upstream/mcp.js";
import { type Poll, polling } from "./poll.js";

/**
 * The driver for ANY mail MCP server: one search tool, called with a query,
 * and whatever it answers read as text. It needs no knowledge of the
 * server's answer shape, only that a search result shows the mail's subject,
 * snippet or body (every mail server's does):
 *
 *   1. before the password is sent, search, and note every code the answer shows;
 *   2. after, search again until a code shows that was not there.
 *
 * A server that lists the newest mail first (all the common ones do) makes
 * the first new code the newest.
 */

/** Argument names a search tool's query goes in, most likely first. */
const QUERY_KEYS = ["query", "q", "search", "searchQuery", "search_query", "keywords", "text", "filter", "criteria"];

const mailish = (name: string): boolean => /mail|message|inbox|thread|gmail|outlook/i.test(name);

/** The search tool and the argument its query goes in, chosen from the server's tools/list. */
export type SearchTool = { readonly tool: ToolInfo; readonly queryKey: string | undefined };

/**
 * Pick the search tool: the one named, or the best guess (a name with
 * "search" that takes a string query argument, preferring mail words in the
 * name). A config failure names the server's tools when nothing fits.
 */
export const pickSearchTool = (tools: readonly ToolInfo[], named: string | undefined): SearchTool => {
  const queryKeyOf = (t: ToolInfo): string | undefined => QUERY_KEYS.find((k) => t.stringProperties.includes(k));
  if (named !== undefined) {
    const tool = tools.find((t) => t.name === named) ?? fail(configError(`the mail MCP server has no tool "${named}" (ANAF_SPV_MAIL_SEARCH_TOOL); it has ${tools.map((t) => t.name).join(", ")}`));
    return { tool, queryKey: queryKeyOf(tool) };
  }
  const candidates = tools
    .filter((t) => /search|find|query/i.test(t.name) && queryKeyOf(t) !== undefined)
    .sort((a, b) => Number(mailish(b.name)) - Number(mailish(a.name)) || Number(/search/i.test(b.name)) - Number(/search/i.test(a.name)));
  const tool =
    candidates[0] ??
    fail(
      configError(
        `none of the mail MCP server's tools looks like a mail search (${tools.map((t) => t.name).join(", ")}); name it in ANAF_SPV_MAIL_SEARCH_TOOL and its arguments in ANAF_SPV_MAIL_SEARCH_ARGS`,
      ),
    );
  return { tool, queryKey: queryKeyOf(tool) };
};

/**
 * The search's arguments: the template when one is configured (`{{query}}`
 * and `{{account}}` filled in), else the query alone in its argument, plus the
 * account where the tool takes one. Every argument the tool requires must be
 * there, or the deployment is told which to add.
 */
export const searchArgs = (search: SearchTool, values: { readonly query: string; readonly account: string | undefined }, template: unknown): Readonly<Record<string, unknown>> => {
  const filled =
    template === undefined
      ? {
          ...(search.queryKey === undefined ? {} : { [search.queryKey]: values.query }),
          ...(values.account !== undefined && search.tool.properties.includes("account") ? { account: values.account } : {}),
        }
      : fillTemplate(template, { query: values.query, account: values.account ?? "" });
  if (typeof filled !== "object" || filled === null || Array.isArray(filled)) fail(configError("ANAF_SPV_MAIL_SEARCH_ARGS must be a JSON object"));
  const args = filled as Readonly<Record<string, unknown>>;
  const missing = search.tool.required.filter((r) => args[r] === undefined);
  if (missing.length > 0) {
    fail(configError(`the mail tool ${search.tool.name} also requires ${missing.join(", ")}; give its arguments in ANAF_SPV_MAIL_SEARCH_ARGS, with {{query}} where the query goes`));
  }
  if (template === undefined && search.queryKey === undefined) {
    fail(configError(`the mail tool ${search.tool.name} takes no query argument this server recognises; give its arguments in ANAF_SPV_MAIL_SEARCH_ARGS, with {{query}} where the query goes`));
  }
  return args;
};

/** Everything an answer shows, as one text: its text content and its structured content. */
const shown = (answer: Answer): string => `${answer.text}\n${answer.json === undefined ? "" : JSON.stringify(answer.json)}`;

export type TextOptions = {
  readonly query: string;
  readonly account: string | undefined;
  readonly tool: string | undefined;
  readonly argsTemplate: unknown;
  readonly poll: Poll;
};

export const watchText = async (connection: Connection, options: TextOptions): Promise<CodeWatch> => {
  const search = pickSearchTool(await connection.tools(), options.tool);
  const args = searchArgs(search, options, options.argsTemplate);
  const run = async (): Promise<readonly string[]> => codesIn(shown(succeeded("mail", search.tool.name, await connection.call(search.tool.name, args))));
  const seen = new Set(await run());
  return {
    next: (deadlineMs) => polling(options.poll, deadlineMs, async () => firstNewCode(await run(), seen)),
    close: () => connection.close(),
  };
};
