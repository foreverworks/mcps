import type { Deps } from "../ports.js";

export const listLabels = ({ gmail }: Deps) => gmail.labels();
