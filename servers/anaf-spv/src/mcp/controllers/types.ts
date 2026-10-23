
import type { McpServer } from "@foreverworks/mcp-kit";
import type { Deps } from "../../app/ports.js";
import type { handled } from "../envelope.js";

export type Handled = typeof handled;

/** A controller registers its tools and nothing else. */
export type Registrar = (server: McpServer, deps: Deps, handled: Handled) => void;
