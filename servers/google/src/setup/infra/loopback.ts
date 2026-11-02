import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import type { Loopback } from "../app/ports.js";

const PAGE = (title: string, text: string): string =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font-family:system-ui,sans-serif;max-width:32em;margin:4em auto;line-height:1.5">` +
  `<h1 style="font-size:1.4em">${title}</h1><p>${text}</p></body>`;

/**
 * A listener on 127.0.0.1, on a port the system picks, for one consent's
 * redirect: Google sends the browser back to it with the code (a Desktop app
 * client accepts any loopback port), and the browser shows a page saying to go
 * back to the terminal. Only the redirect counts; anything else the browser
 * asks for (a favicon) gets a 404. Bound to the loopback address alone, so
 * nothing outside this computer can reach it.
 */
export const listenOnLoopback = async (): Promise<Loopback> => {
  let deliver: (url: string) => void = () => undefined;
  const reached = new Promise<string>((resolve) => {
    deliver = resolve;
  });
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
    if (!url.searchParams.has("code") && !url.searchParams.has("error")) {
      res.writeHead(404).end();
      return;
    }
    const refused = url.searchParams.get("error");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(
      refused
        ? PAGE("Not approved", "Google did not approve the request. Go back to the terminal to try again.")
        : PAGE("Approved", "Go back to the terminal; you can close this tab."),
    );
    deliver(url.href);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    redirectUri: `http://127.0.0.1:${port}/`,
    arrived: (signal) =>
      new Promise<string>((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        void reached.then(resolve);
      }),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
};
