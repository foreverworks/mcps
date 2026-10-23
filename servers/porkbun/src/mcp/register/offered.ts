import type { ToolAnnotations, ToolArgs } from "@foreverworks/mcp-kit";
import { z, type ZodType } from "zod";

import type { Deps, ToolSpec } from "../../app/ports.js";

/** A vendor tool as this server offers it: its description and input schema, and what a call runs. */
export type OfferedTool = {
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, ZodType>>;
  readonly run: (args: ToolArgs) => Promise<unknown>;
};

/** A tool of this server's own, offered beside the vendor's: its name, its annotations, and how it is built. Its access is in src/mcp/policy.ts (OWN). */
export type OwnTool = { readonly name: string; readonly annotations: ToolAnnotations; readonly make: (deps: Deps) => OfferedTool };

/**
 * How one vendor tool is wrapped. It checks at startup that the vendor's tool
 * still takes what the wrapper hands it, and throws otherwise, which stops the
 * server: a vendor version that changed a wrapped tool must not run on a guess.
 */
export type Wrapper = (deps: Deps, vendor: ToolSpec, revealsSecrets: boolean) => OfferedTool;

/** Stops the server unless the vendor's tool still accepts `sample`, the shape this server sends it. */
export const expectVendorTakes = (vendor: ToolSpec, sample: Readonly<Record<string, unknown>>, file: string): void => {
  if (!z.object(vendor.inputSchema).safeParse(sample).success) {
    throw new Error(`porkbun: the vendor's ${vendor.name} no longer takes ${JSON.stringify(sample)}; ${file} must follow it`);
  }
};

/** A vendor argument's own schema, or `fallback` when a version dropped it (the startup check then fails first). */
export const vendorArg = (vendor: ToolSpec, name: string, fallback: ZodType): ZodType => vendor.inputSchema[name] ?? fallback;
