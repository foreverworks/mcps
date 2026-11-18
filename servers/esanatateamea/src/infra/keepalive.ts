import type { SessionPort } from "../app/ports.js";
import { asAppError } from "../domain/errors.js";
import { isRefreshExpired } from "../domain/session.js";

/**
 * Keep an idle SSO session alive: refresh every `everyMin` minutes while a
 * live session is stored. Keycloak ends a session that sits idle longer than
 * the realm's idle timeout, and the user's tasks may come hours apart. Nothing
 * is logged on success; a refusal is one line on stderr (the journal), and
 * the session's own state then says "expired". The timer never keeps the
 * process alive on its own (unref), so a stdio copy still exits with its
 * client.
 */
export const startKeepalive = (session: SessionPort, everyMin: number, now: () => number, log: (line: string) => void = (l) => console.error(l)): (() => void) => {
  const tick = async (): Promise<void> => {
    const stored = await session.read().catch(() => undefined);
    if (stored === undefined || isRefreshExpired(stored, now())) return;
    await session.rotate().catch((thrown: unknown) => {
      const failure = asAppError(thrown);
      log(`keepalive ${JSON.stringify({ outcome: failure?.kind ?? "error", message: failure !== undefined && "message" in failure ? failure.message : String(thrown) })}`);
    });
  };
  const timer = setInterval(() => void tick(), everyMin * 60_000);
  timer.unref();
  return () => clearInterval(timer);
};
