/**
 * What a zod parse objected to, as one line: `path: message; ...`, the first
 * few only. zod 4's messages name what was expected, never the value received,
 * so the line is safe for a file that holds a secret and for a response that
 * holds someone's data. The root of the document is `(root)`.
 */
export type Issues = { readonly issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[] };

export const issuesText = ({ issues }: Issues, limit = 5): string => {
  const shown = issues.slice(0, limit).map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`);
  return issues.length > limit ? `${shown.join("; ")}; and ${issues.length - limit} more` : shown.join("; ");
};
