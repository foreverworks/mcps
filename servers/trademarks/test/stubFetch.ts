/** A fetch that answers from a script and records what was asked. */
export type Asked = { readonly url: string; readonly method: string; readonly headers: Record<string, string>; readonly body: string | undefined };

export type Answer = { readonly status?: number; readonly json?: unknown; readonly text?: string; readonly contentType?: string };

export const stubFetch = (answer: (asked: Asked, n: number) => Answer) => {
  const asked: Asked[] = [];
  const fetch = (async (input: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = typeof init?.body === "string" ? init.body : init?.body === undefined || init.body === null ? undefined : String(init.body);
    const one: Asked = { url: String(input), method: init?.method ?? "GET", headers, body };
    asked.push(one);
    const a = answer(one, asked.length - 1);
    const text = a.text ?? JSON.stringify(a.json ?? {});
    return new Response(text, { status: a.status ?? 200, headers: { "content-type": a.contentType ?? (a.text === undefined ? "application/json" : "text/html") } });
  }) as typeof globalThis.fetch;
  return { fetch, asked };
};

/** No waiting in tests: the pacer and the backoff both sleep through this. */
export const noSleep = async (): Promise<void> => undefined;
