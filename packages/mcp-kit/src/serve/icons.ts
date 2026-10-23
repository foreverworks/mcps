import type { Icon } from "@modelcontextprotocol/server";

import type { ToolPolicy } from "../policy.js";

/** A product of a server that serves several, and the tools that are its (its part of the policy). */
export type Product = { readonly icons: readonly Icon[]; readonly tools: ToolPolicy };

/** Each tool's product icons, refusing a product that names a tool nobody classified, or a tool in two products. */
export const toolIconsOf = (name: string, policy: ToolPolicy, products: readonly Product[]): ReadonlyMap<string, readonly Icon[]> => {
  const icons = new Map<string, readonly Icon[]>();
  for (const product of products) {
    for (const tool of Object.keys(product.tools)) {
      if (policy[tool] === undefined) throw new Error(`${name}: a product names ${tool}, which the policy does not`);
      if (icons.has(tool)) throw new Error(`${name}: ${tool} is in two products`);
      icons.set(tool, product.icons);
    }
  }
  return icons;
};
