import type { McpServer } from "@foreverworks/mcp-kit";


/** A controller registers its tools and nothing else; the registry is the product's. */
export type Registrar<R> = (server: McpServer, registry: R) => void;
