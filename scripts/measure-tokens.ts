/**
 * What a server's tool list costs a client, and what output schemas add to it,
 * the way Sentry measures its own (getsentry/sentry-mcp,
 * packages/mcp-core/scripts/measure-token-cost.ts): each built server started
 * as a client sees it (listed.ts), each tool's definition as it arrives, and
 * the share of it its outputSchema takes. Tokens are counted with the GPT-4
 * tokenizer when `gpt-tokenizer` can be imported (`npm i --no-save
 * gpt-tokenizer`; it is no dependency of this repository), and bytes always.
 *
 * Results are not measured here: a structured result is the same JSON as its
 * text block, so a client that passes both to the model pays a result twice,
 * and one that passes either pays it once. Claude Code passes the structured
 * content in place of the text and shows the model no output schema (checked
 * 2026-10-22 with claude -p against a probe server).
 *
 * 2026-10-22, the first users: bnr 3 tools 635 -> 1,320 tokens with output
 * schemas; trademarks 3 tools 927 -> 2,288; eas 19 tools 5,102 -> 6,738 (its
 * seven lists).
 *
 *   npx tsx scripts/measure-tokens.ts [server ...]
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { listServer } from "./listed.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

type Encode = (text: string) => readonly number[];

/** The tokenizer, if it is installed; a variable name keeps the typecheck from requiring it. */
const tokenizer = async (): Promise<Encode | undefined> => {
  const name = "gpt-tokenizer";
  try {
    return ((await import(name)) as { encode: Encode }).encode;
  } catch {
    return undefined;
  }
};

const main = async (): Promise<void> => {
  const encode = await tokenizer();
  const weigh = (value: unknown): string => {
    const text = JSON.stringify(value);
    return `${Buffer.byteLength(text)} B${encode === undefined ? "" : ` ${encode(text).length} tok`}`;
  };
  const asked = process.argv.slice(2);
  const servers = asked.length > 0 ? asked : readdirSync(join(ROOT, "servers")).sort();
  for (const server of servers) {
    const { tools } = await listServer(join(ROOT, "servers", server));
    const typed = tools.filter((t) => t.outputSchema !== undefined);
    const without = tools.map(({ outputSchema: _o, ...rest }) => rest);
    console.log(`${server}: ${tools.length} tools, ${weigh(tools)}; without output schemas ${weigh(without)}; ${typed.length} with one`);
    for (const tool of typed) {
      const { outputSchema, ...rest } = tool;
      console.log(`  ${tool.name}: ${weigh(tool)}, of which outputSchema ${weigh(outputSchema)} (the rest ${weigh(rest)})`);
    }
  }
  if (encode === undefined) console.log("(bytes only: npm i --no-save gpt-tokenizer for token counts)");
};

await main();
