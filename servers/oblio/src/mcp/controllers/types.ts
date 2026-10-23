
import type { McpServer } from "@foreverworks/mcp-kit";
import type { Deps } from "../../app/ports.js";

/** A controller registers its tools and nothing else. */
export type Registrar = (server: McpServer, deps: Deps) => void;
