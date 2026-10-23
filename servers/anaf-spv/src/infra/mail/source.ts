import type { CodeInfo, CodeSource } from "../../app/ports.js";
import type { Connect } from "../upstream/mcp.js";
import { looksLikeGoogle, watchGoogle } from "./google.js";
import type { Poll } from "./poll.js";
import { watchText } from "./text.js";

/**
 * Where the e-mailed code is read from, by driver:
 *
 * - `auto` (the default when a mail MCP server is configured): asks the
 *   server for its tools and takes `google` when it has that driver's two
 *   tools, else `text`;
 * - `google`: a server shaped like this repository's google server;
 * - `text`: any mail server with a search tool (text.ts);
 * - `manual`: nobody reads mail; every sign-in waits for complete_login.
 *
 * A driver is chosen per sign-in, after connecting, so a server that gains
 * or changes tools is picked up without a restart.
 */
export type MailDriver = "auto" | "google" | "text" | "manual";

export type MailConfig =
  | { readonly driver: "manual"; readonly why: string }
  | {
      readonly driver: Exclude<MailDriver, "manual">;
      readonly connect: Connect;
      readonly transport: "http" | "stdio";
      readonly endpoint: string;
      readonly query: string;
      readonly account: string | undefined;
      readonly tool: string | undefined;
      readonly argsTemplate: unknown;
    };

export const makeCodeSource = (config: MailConfig, poll: Poll): CodeSource => {
  if (config.driver === "manual") return { info: { driver: "manual", why: config.why }, watch: async () => undefined };
  const info: CodeInfo = {
    driver: config.driver,
    transport: config.transport,
    detail: `${config.endpoint}${config.account === undefined ? "" : `, mailbox ${config.account}`}`,
  };
  return {
    info,
    watch: async () => {
      const connection = await config.connect();
      try {
        const google = config.driver === "google" || (config.driver === "auto" && looksLikeGoogle(await connection.tools()));
        return google
          ? await watchGoogle(connection, { query: config.query, account: config.account, poll })
          : await watchText(connection, { query: config.query, account: config.account, tool: config.tool, argsTemplate: config.argsTemplate, poll });
      } catch (thrown) {
        await connection.close();
        throw thrown;
      }
    },
  };
};

