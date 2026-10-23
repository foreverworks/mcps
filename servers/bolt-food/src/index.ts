#!/usr/bin/env node
import { packageIdentity, packageVersion } from "@foreverworks/mcp-kit";
import { runServer } from "@foreverworks/receipts/mcp";

import { NAME } from "./app/usecases/receipts.js";
import { runHealthCheck } from "./cli/health.js";
import { buildDeps } from "./composition.js";
import { registerAll } from "./mcp/register.js";
import { INSTRUCTIONS } from "./mcp/register/copy.js";

/** Read-only MCP server for Bolt Food order history and itemised receipts (packages/receipts, mcp/main.ts). */
runServer({ name: NAME, version: packageVersion(import.meta.url), ...packageIdentity(import.meta.url), instructions: INSTRUCTIONS, buildDeps, register: registerAll, healthCheck: runHealthCheck });
