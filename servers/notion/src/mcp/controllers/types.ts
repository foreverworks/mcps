import type { McpServer } from "@foreverworks/mcp-kit";
import type { z } from "zod";

import type { Deps } from "../../app/ports.js";

/** A controller registers its tools and nothing else. */
export type Registrar = (server: McpServer, deps: Deps) => void;

/** The arguments a tool's input shape parses to. */
export type ArgsOf<S extends z.ZodRawShape> = z.infer<z.ZodObject<S>>;
