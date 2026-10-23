
import type { McpServer } from "@foreverworks/mcp-kit";
import type { Registry } from "../../composition.js";

/** A controller registers its tools and nothing else. */
export type Registrar = (server: McpServer, registry: Registry) => void;
