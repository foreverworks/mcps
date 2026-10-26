/**
 * The names closest to one that was not found, for a failure to suggest: a
 * name that contains it or that it contains first, then the fewest edits
 * apart, within a third of its length. Pure.
 */

const distance = (a: string, b: string): number => {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
};

export const closest = (name: string, candidates: readonly string[], max = 5): readonly string[] => {
  const wanted = name.toLowerCase();
  const scored = candidates
    .map((candidate) => {
      const c = candidate.toLowerCase();
      const contains = c.includes(wanted) || (c.length >= 3 && wanted.includes(c));
      return { candidate, score: contains ? 0 : distance(wanted, c) };
    })
    .filter((s) => s.score <= Math.max(2, Math.floor(wanted.length / 3)));
  return [...new Set(scored.sort((x, y) => x.score - y.score || x.candidate.localeCompare(y.candidate)).map((s) => s.candidate))].slice(0, max);
};
