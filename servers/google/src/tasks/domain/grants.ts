import { SCOPE_ROOT } from "../../domain/scopes.js";

/**
 * Read and write tasks and lists, the least scope that writes:
 * tasks.readonly reads only, and nothing narrower exists.
 */
export const TASKS = `${SCOPE_ROOT}tasks`;
export const REQUIRED_SCOPES = [TASKS] as const;
