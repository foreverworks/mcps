import { createInterface } from "node:readline/promises";

import type { Terminal } from "../app/ports.js";

/**
 * The person at the terminal, through readline. Ctrl+C stops setup at once:
 * everything it saved so far is complete on disk (each file is written whole),
 * so stopping between steps leaves nothing half done.
 */
export const makeTerminal = (input: NodeJS.ReadStream = process.stdin, output: NodeJS.WriteStream = process.stdout): Terminal & { readonly close: () => void } => {
  const rl = createInterface({ input, output });
  rl.on("SIGINT", () => {
    output.write("\nSetup stopped. What it saved so far stays; run it again to continue.\n");
    process.exit(130);
  });

  const ask = async (question: string, fallback?: string): Promise<string> => {
    const answer = (await rl.question(fallback !== undefined ? `${question} [${fallback}]: ` : `${question}: `)).trim();
    return answer || fallback || "";
  };

  const askOrWait = async <T>(question: string, wait: (signal: AbortSignal) => Promise<T>) => {
    const stop = new AbortController();
    const typed = rl.question(`${question}: `, { signal: stop.signal }).then((text) => ({ typed: text.trim() }));
    const found = wait(stop.signal).then((value) => ({ found: value }));
    // Whichever loses is withdrawn: a question nobody answered, or a wait nothing ended.
    typed.catch(() => undefined);
    found.catch(() => undefined);
    try {
      const first = await Promise.race([typed, found]);
      if ("found" in first) output.write("\n");
      return first;
    } finally {
      stop.abort();
    }
  };

  return { say: (text) => void output.write(`${text}\n`), ask, askOrWait, close: () => rl.close() };
};
