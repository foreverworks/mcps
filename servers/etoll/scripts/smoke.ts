/**
 * Live smoke test: drives the built server over the real MCP protocol, as a
 * client would. Needs an eToll account (or proves what happens without one);
 * everything in test/ needs none.
 *
 *   npm run build -w @foreverworks/mcp-etoll
 *   ETOLL_STATE_DIR=<dir> ETOLL_USERNAME=<login> ETOLL_PASSWORD_FILE=<file> npx tsx scripts/smoke.ts   # stdio, password
 *   ETOLL_STATE_DIR=<dir> npx tsx scripts/smoke.ts                                                       # stdio, a session already there
 *   MCP_URL=http://127.0.0.1:<port>/mcp MCP_TOKEN_FILE=<file> npx tsx scripts/smoke.ts                   # a running service
 *
 * READ-ONLY by default. It never begins or completes a browser sign-in. With
 * a password configured, its first read signs in, as any call would. Without
 * a session it checks that every read answers needs_login with a remedy that
 * names begin_login. With one it reads health, session_status (probing once),
 * the cars, a page of tolls, the invoices of the last year, the notifications
 * and the status page, and quotes a vignette for the first car (which orders
 * nothing), checking each answer's shape. These are the first live answers
 * behind the sign-in: a `drift` here means the shapes in src/domain/schema.ts
 * need correcting.
 *
 * --order WRITES: after "yes" at the terminal it also places an order for
 * the cheapest option quoted (it never pays: the payment page is printed, not opened), reads it back, and
 * cancels it at once, then cancels again to show the second is harmless. Run
 * it only against an account where an unpaid order for a day's vignette is
 * acceptable for a few seconds.
 *
 * --buy=<duration code> [--start=YYYY-MM-DD] WRITES and is meant to be paid:
 * after "yes" at the terminal it orders that option for the first car (e.g.
 * TEN_DAYS) and prints the payment page without cancelling. Paying it there
 * buys the vignette. Then --paid=<order id> checks that get_order reads it
 * paid and that list_tolls and list_vehicles show the vignette.
 */
import { createInterface } from "node:readline/promises";

import { connectSmoke, toolJson } from "@foreverworks/mcp-kit";

const argOf = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const ORDER = process.argv.includes("--order");
const BUY = argOf("buy");
const START = argOf("start");
const PAID = argOf("paid");

const confirmed = async (question: string): Promise<boolean> => {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await terminal.question(`${question} Type yes to go on: `)).trim().toLowerCase() === "yes";
  } finally {
    terminal.close();
  }
};

const show = (label: string, value: unknown, max = 900): void => console.log(`${label}:`, JSON.stringify(value).slice(0, max));

const failures: string[] = [];
const check = (ok: boolean, what: string): void => {
  console.log(`  ${ok ? "ok" : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

const main = async (): Promise<void> => {
  const client = await connectSmoke();
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const started = Date.now();
    const out = toolJson(await client.callTool({ name, arguments: args }));
    console.log(`  (${name}: ${Date.now() - started} ms)`);
    return out;
  };

  const { tools } = await client.listTools();
  console.log("tools:", tools.map((t) => t.name).sort().join(", "));
  check(tools.length === 15, "fifteen tools");

  const health = await call("health");
  show("\nhealth", health);
  check(health.ok === true, "health is ok");

  const status = await call("service_status");
  show("service_status", status);
  check(status.ok === true && Array.isArray(status.components), "service_status reads CNAIR's status page");

  const vehicles = await call("list_vehicles");
  if (vehicles.error?.kind === "needs_login" || vehicles.error?.kind === "login_refused") {
    show("list_vehicles", vehicles);
    console.log("\nno session: every read must say so and how to fix it");
    check(typeof vehicles.error.remedy === "string" && vehicles.error.remedy.includes("begin_login"), "the remedy names begin_login");
    for (const name of ["list_tolls", "list_invoices", "notifications"]) {
      const out = await call(name);
      check(out.error?.kind === vehicles.error.kind, `${name} answers ${vehicles.error.kind}`);
    }
  } else {
    show("list_vehicles", vehicles);
    check(vehicles.ok === true && Array.isArray(vehicles.vehicles), "list_vehicles answers a list");
    const session = await call("session_status", { probe: true });
    show("session_status", session);
    check(session.connected === true, "session_status says connected after a probe");

    const tolls = await call("list_tolls", { size: 5 });
    show("list_tolls", tolls);
    check(tolls.ok === true && Array.isArray(tolls.tolls), "list_tolls answers a list");
    const invoices = await call("list_invoices");
    show("list_invoices", invoices);
    check(invoices.ok === true && Array.isArray(invoices.invoices), "list_invoices answers a list");
    const notes = await call("notifications");
    show("notifications", notes);
    check(notes.ok === true && Array.isArray(notes.notifications), "notifications answers a list");

    const car = vehicles.vehicles?.[0];
    if (car === undefined) {
      console.log("  (no cars on the account: quote_vignette not exercised)");
    } else {
      const quote = await call("quote_vignette", { vehicle: car.id, ...(START === undefined ? {} : { start_date: START }) });
      show("quote_vignette", quote);
      if (quote.ok === true) {
        check(Array.isArray(quote.options) && quote.options.length > 0, "quote_vignette offers options");
        check(quote.options.every((o: { price?: { total?: unknown } }) => typeof o.price?.total === "string"), "every option has an exact total");
      } else {
        console.log(`  (quote refused: ${quote.error?.kind} ${quote.error?.code ?? ""}; eToll may not sell this car a vignette now)`);
      }

      const cheapest = quote.ok === true ? [...quote.options].sort((a, b) => Number(a.price.total) - Number(b.price.total))[0] : undefined;
      // A real order on the account, cancelled at once and never paid; asked first, like --buy, since a crash in between leaves it open.
      if (ORDER && cheapest !== undefined && (await confirmed(`\nPlace a real ${cheapest.duration} order for ${car.plate} (${cheapest.price.total} RON) and cancel it at once? Nothing is paid.`))) {
        const placed = await call("place_order", { quote_id: cheapest.quote_id });
        show("\nplace_order", placed);
        check(placed.ok === true && typeof placed.order_id === "string", "place_order answers an order");
        check(typeof placed.payment_url === "string" && new URL(placed.payment_url).hostname.endsWith("euplatesc.ro"), "the payment page is on euplatesc.ro");
        if (placed.ok === true) {
          const read = await call("get_order", { order_id: placed.order_id });
          show("get_order", read);
          check(read.state === "pending", "the order reads back pending");
          const cancelled = await call("cancel_order", { order_id: placed.order_id });
          show("cancel_order", cancelled);
          check(cancelled.ok === true, "cancel_order drops it");
          const again = await call("cancel_order", { order_id: placed.order_id });
          check(again.ok === true && again.already_gone === true, "a second cancel_order is harmless");
        }
      }

      if (BUY !== undefined && quote.ok === true) {
        type Option = { quote_id: string; duration: string; duration_code: string; valid_from: string; valid_until: string; price: { total: string } };
        const option = (quote.options as Option[]).find((o) => o.duration_code === BUY);
        check(option !== undefined, `the quote offers ${BUY}`);
        if (option === undefined) {
          console.log(`  (offered: ${(quote.options as Option[]).map((o) => o.duration_code).join(", ")})`);
        } else if (!(await confirmed(`\nOrder a ${option.duration} vignette for ${car.plate}, ${option.valid_from} to ${option.valid_until}, ${option.price.total} RON?`))) {
          console.log("  (not ordered)");
        } else {
          const placed = await call("place_order", { quote_id: option.quote_id });
          show("\nplace_order", placed, 2000);
          check(placed.ok === true && typeof placed.payment_url === "string" && new URL(placed.payment_url).hostname.endsWith("euplatesc.ro"), "place_order hands over a euplatesc.ro page");
          if (placed.ok === true) {
            console.log(`\nPay here (until ${placed.expires_at}):\n  ${placed.payment_url}\nThen run this script with --paid=${placed.order_id}`);
          }
        }
      }
    }
  }

  if (PAID !== undefined) {
    const order = await call("get_order", { order_id: PAID });
    show("\nget_order", order, 3000);
    check(order.state === "paid", "get_order reads the order paid");
    check(Array.isArray(order.vignettes) && order.vignettes.length > 0, "get_order finds the vignette the payment issued");
    const active = await call("list_tolls", { status: "ACTIVE", size: 10 });
    show("list_tolls ACTIVE", active, 3000);
    check(active.ok === true && active.tolls.length > 0, "list_tolls shows an active vignette");
    const cars = await call("list_vehicles");
    show("list_vehicles", cars, 2000);
    check(cars.ok === true && cars.vehicles.some((v: { plate?: string; vignette?: unknown }) => v.plate === order.plate && v.vignette !== null), "list_vehicles shows the car's vignette");
    const invoices = await call("list_invoices");
    show("list_invoices", invoices, 2000);
    console.log(`  (${invoices.invoices?.length ?? 0} invoice(s) so far; eToll may issue it later)`);
  }

  // The kit makes every input strict: a misspelt argument is a protocol error naming it, not a default silently used.
  const unknown = (await client.callTool({ name: "list_tolls", arguments: { sizee: 3 } })) as { isError?: boolean; content: { text: string }[] };
  check(unknown.isError === true && (unknown.content[0]?.text ?? "").includes("sizee"), "an unknown argument is refused, by name");

  await client.close();
  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log("\nsmoke: every check passed");
};

main().catch((error: unknown) => {
  console.error("smoke failed:", error);
  process.exit(1);
});
