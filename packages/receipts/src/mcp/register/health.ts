import type { Registrar } from "../tools.js";

export const registerHealth: Registrar = (server, deps, tools, handled) => {
  server.registerTool(
    "health",
    { title: "Health", description: tools.copy.health, inputSchema: {} },
    handled(() => tools.health(deps)),
  );
};
