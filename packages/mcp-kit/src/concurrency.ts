/**
 * Bounded concurrency and short-lived memory: the two things every API adapter
 * here ends up wanting, written once.
 */

/**
 * Map with at most `limit` calls in flight, preserving input order. Each
 * server picks its own limit and records why (Gmail's 16 was measured).
 */
export const mapWithConcurrency = async <T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<readonly R[]> => {
  const results = new Array<R>(items.length);
  const cursor = { next: 0 };
  const worker = async (): Promise<void> => {
    for (let i = cursor.next++; i < items.length; i = cursor.next++) {
      results[i] = await fn(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, worker));
  return results;
};

/**
 * Remembers an async result per key for `ttlMs`, and shares one in-flight call
 * among everyone who asks for that key while it runs. A failure is not
 * remembered. Use it only for what may be up to `ttlMs` stale without harm (a
 * catalogue, a nomenclature, an order history page), never for a balance.
 */
export const memoize = <K, T>(ttlMs: number, fn: (key: K) => Promise<T>, now: () => number = Date.now): ((key: K) => Promise<T>) => {
  const entries = new Map<K, { readonly value: Promise<T>; readonly at: number }>();
  return (key: K) => {
    const hit = entries.get(key);
    if (hit !== undefined && now() - hit.at < ttlMs) return hit.value;
    const value = fn(key);
    entries.set(key, { value, at: now() });
    value.catch(() => {
      if (entries.get(key)?.value === value) entries.delete(key);
    });
    return value;
  };
};
