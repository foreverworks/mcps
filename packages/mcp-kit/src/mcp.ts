/**
 * The MCP SDK as the servers here see it: the one module that names its
 * packages (SDK v2: `@modelcontextprotocol/server`, `/client`, `/node`). A
 * server registers its tools on `McpServer` and its tests drive it with
 * `Client`; both come from here, so moving to another SDK release is a change
 * to this file and the kit, not to every server.
 */
export { Client, InMemoryTransport, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
export { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";
export { McpServer } from "@modelcontextprotocol/server";
export type { CallToolResult, Icon, Implementation, ProtocolEra, Tool, ToolAnnotations, Transport } from "@modelcontextprotocol/server";
