import { toolsetsFrom, type ToolPolicy } from "@foreverworks/mcp-kit";

import { EDITOR_APIS, type EditorApi } from "../editors/mcp/reference.js";
import { PRODUCTS, TOOLSETS, type Toolset } from "./policy.js";

/**
 * The toolsets this process loads: GOOGLE_TOOLSETS, a comma-separated list
 * of TOOLSETS' names; unset, blank or `all` loads every one. A name that is
 * not a toolset stops the process at start, naming the ones there are.
 */
export const loadedToolsets = (env: NodeJS.ProcessEnv = process.env): readonly Toolset[] => toolsetsFrom(env, "GOOGLE_TOOLSETS", TOOLSETS);

/** The editors among the loaded toolsets, whose batch tools editors_api_reference serves. */
export const editorApisOf = (loaded: readonly Toolset[]): readonly EditorApi[] => EDITOR_APIS.filter((api) => loaded.includes(api));

/** The loaded products whose tools carry their icon (PRODUCTS), with those tools. */
export const productsOf = (loaded: readonly Toolset[]): readonly (readonly [string, ToolPolicy])[] =>
  Object.entries(PRODUCTS).filter(([product]) => (loaded as readonly string[]).includes(product));
