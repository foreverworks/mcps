import { buildRegistries } from "../composition.js";
import { runSetup } from "../setup/app/setup.js";
import { buildSetup } from "../setup/composition.js";
import { makeTerminal } from "../setup/infra/terminal.js";

/**
 * `mcp-google setup`: the interactive setup, for a person at a terminal. It
 * asks questions and opens a browser, so without a terminal on both ends (a
 * client starting the server, a pipe, a CI job) it refuses and says how to run
 * it instead.
 */
export const runSetupCommand = async (env: NodeJS.ProcessEnv = process.env): Promise<number> => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("setup asks questions and opens your browser, so it needs a terminal. Run it in one:");
    console.error("");
    console.error("  npx -y @foreverworks/mcp-google setup");
    return 2;
  }
  const terminal = makeTerminal();
  try {
    return await runSetup(buildSetup(env, buildRegistries(env), terminal));
  } finally {
    terminal.close();
  }
};
