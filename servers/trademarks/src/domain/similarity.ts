import { folded } from "./match.js";

/**
 * How alike two marks are, as one number from 0 to 100, computed here the same
 * way for every office, so a USPTO candidate and an EUIPO one can be compared:
 * half how they are written (edit distance between the folded texts), half how
 * they sound (edit distance between their phonetic keys). Identical marks
 * score 100; TURNIP and DURNIP 92; TURNIP and TURNIP QPT 67. Pure.
 *
 * It measures the whole marks against each other, nothing more: a mark that
 * contains the name scores lower the more it adds, and no number here knows
 * goods and services or what an examiner would decide.
 */

/** Levenshtein distance: insertions, deletions and substitutions, one each. */
export const editDistance = (a: string, b: string): number => {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
};

/** Spellings that make one sound, rewritten first, in this order. X stands for the sh sound: folded text has no capitals. */
const SPELLINGS: readonly (readonly [RegExp, string])[] = [
  [/que$/, "k"],
  [/(?<=..[^aeiouy])e$/, ""],
  [/^kn|^gn|^pn/, "n"],
  [/^wr/, "r"],
  [/^ps/, "s"],
  [/^x/, "s"],
  [/x/g, "ks"],
  [/sch/g, "sk"],
  [/tch|sh|ch/g, "X"],
  [/ph/g, "f"],
  [/(?<!^)gh/g, ""],
  [/ck|qu?/g, "k"],
  [/c(?=[eiy])/g, "s"],
  [/g(?=[eiy])/g, "j"],
];

/**
 * Letters that sound alike to a listener, voiced or not: one class each. Vowels
 * (and y) are one class too, so the key keeps where syllables are; h is
 * silent once the spellings above are read.
 */
const CLASS: Readonly<Record<string, string>> = {
  a: "a", e: "a", i: "a", o: "a", u: "a", y: "a",
  b: "p", p: "p",
  f: "f", v: "f",
  c: "k", g: "k", k: "k",
  d: "t", t: "t",
  s: "s", z: "s",
  m: "n", n: "n",
  j: "j", l: "l", r: "r", w: "w", X: "x",
  h: "",
};

/**
 * A key for how a Latin-script mark sounds: its folded text with the spellings
 * of one sound rewritten (ph, ck, soft c and g, a silent gh or final e), each letter
 * replaced by its class, and repeats collapsed. TURNIP, DURNIP, TERNIP and DURNNIP
 * share one key. Digits stay as they are.
 */
export const phoneticKey = (text: string): string => {
  let s = folded(text);
  for (const [pattern, sound] of SPELLINGS) s = s.replace(pattern, sound);
  const classes = [...s].map((ch) => CLASS[ch] ?? ch).join("");
  return classes.replace(/(.)\1+/gu, "$1");
};

const likeness = (a: string, b: string): number => {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 0 : 1 - editDistance(a, b) / longest;
};

/** 0 to 100; undefined for a mark with no words (a logo, a sound), which nothing here can compare. */
export const similarityOf = (name: string, mark: string | null): number | undefined => {
  if (mark === null || folded(mark) === "") return undefined;
  return Math.round(50 * likeness(folded(name), folded(mark)) + 50 * likeness(phoneticKey(name), phoneticKey(mark)));
};
