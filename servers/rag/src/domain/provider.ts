/**
 * Where a collection's chunks are embedded. `local` is the embed endpoint the
 * server also embeds every question with; a remote provider serves the same
 * model elsewhere, so it can index a large corpus faster while search stays
 * local. That only works when the two give the same vectors, which a probe
 * proves before a collection is set to a remote provider.
 */
export const PROVIDERS = ["local", "cloudflare"] as const;
export type Provider = (typeof PROVIDERS)[number];
export type RemoteProvider = Exclude<Provider, "local">;

/** What embedding cost, as the provider reports it: Workers AI counts input tokens and neurons. */
export type Usage = { readonly requests: number; readonly texts: number; readonly tokens: number; readonly neurons: number };

export const NO_USAGE: Usage = { requests: 0, texts: 0, tokens: 0, neurons: 0 };

export const addUsage = (a: Usage, b: Usage): Usage => ({
  requests: a.requests + b.requests,
  texts: a.texts + b.texts,
  tokens: a.tokens + b.tokens,
  // Neurons are fractional: summing many small floats is kept to a fixed precision.
  neurons: Math.round((a.neurons + b.neurons) * 1e6) / 1e6,
});

/**
 * Texts a remote provider must embed as the local endpoint does: one plain
 * sentence, one with diacritics, one with digits and punctuation.
 */
export const PROBE_TEXTS: readonly string[] = [
  "The committee released the documents on a Thursday, and the court unsealed the rest a week later.",
  "Chiriașul plătește reparațiile curente; proprietarul răspunde de structura clădirii și de instalații.",
  "Invoice 2024-117: 3 items, total 1,250.00 EUR, due within 30 days (see clause 4.2).",
];

/** The least cosine similarity, over every probe text, for two endpoints to count as one model. */
export const MIN_PROBE_COSINE = 0.999;

export const cosine = (a: readonly number[], b: readonly number[]): number => {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
};

export type ProbeResult = { readonly agrees: boolean; readonly min_cosine: number; readonly texts: number; readonly dimensions: readonly [number, number] };

/** Whether two endpoints embedded the probe texts alike: same length, and every pair at least MIN_PROBE_COSINE apart. */
export const compareProbe = (local: readonly (readonly number[])[], remote: readonly (readonly number[])[]): ProbeResult => {
  const dimensions: readonly [number, number] = [local[0]?.length ?? 0, remote[0]?.length ?? 0];
  const sameShape = local.length === remote.length && local.length > 0 && local.every((v, i) => v.length === remote[i]?.length);
  const min = sameShape ? Math.min(...local.map((v, i) => cosine(v, remote[i] ?? []))) : 0;
  const rounded = Math.floor(min * 1e6) / 1e6;
  return { agrees: sameShape && min >= MIN_PROBE_COSINE, min_cosine: rounded, texts: local.length, dimensions };
};

/** Texts cut into batches of at most `size`, in order. */
export const batches = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / Math.max(1, size)) }, (_, i) => items.slice(i * size, (i + 1) * size));
