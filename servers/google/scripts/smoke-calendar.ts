/**
 * Live smoke test: spawns the built server over stdio and drives it as a real
 * MCP client would. Needs the calendar grants; everything in test/ does not.
 *
 *   npm run build && npx tsx scripts/smoke-calendar.ts              # reads, then one write cycle
 *   npm run build && npx tsx scripts/smoke-calendar.ts --read-only  # reads only, nothing written
 *
 * Reads every account (agenda, free_busy, find_time), then writes ONE
 * throwaway event on SMOKE_ACCOUNT's calendar (else the default account's), moves it, reads it back and
 * deletes it, with nobody notified and no reminders, because a write tool
 * never exercised against the real API is a claim rather than a result.
 * `--read-only` stops before the first write tool is called.
 */
import { connectSmoke, toolJson } from "@foreverworks/mcp-kit";

const main = async (): Promise<void> => {
  const client = await connectSmoke();
  const call = async (name: string, args: Record<string, unknown> = {}) => toolJson(await client.callTool({ name, arguments: args }));

  const { tools } = await client.listTools();
  console.log("tools:", tools.map((t) => t.name).sort().join(", "));

  const listed = await call("list_accounts");
  console.log("\nlist_accounts:", JSON.stringify(listed));
  // health answers per product; this script is about the calendar section.
  const health = (await call("health")).calendar;
  console.log("health:", JSON.stringify(health));
  if (!health.allOk) {
    await client.close();
    process.exit(1);
  }

  const cals = await call("list_calendars");
  for (const a of cals.accounts) console.log(`calendars ${a.account}: ${a.calendars?.length ?? a.error} (${a.calendars?.filter((c: { inAgendaByDefault: boolean }) => c.inAgendaByDefault).length} in agenda)`);

  const week = await call("agenda", { days: 7 });
  console.log(`\nagenda ${week.from} -> ${week.to}: ${week.events?.length} events, ${week.conflicts?.length} conflicts, ${week.pendingInvites?.length} pending, failures=${JSON.stringify(week.failures ?? [])}`);

  // READ-ONLY from here to the writes: free/busy across both accounts, and where half an hour fits.
  const busy = await call("free_busy", { days: 7 });
  console.log(
    `\nfree_busy ${busy.from} -> ${busy.to}: ${busy.busy?.length} merged blocks from ${busy.calendars?.length} calendars, ` +
      `complete=${busy.complete}, unknown=${JSON.stringify(busy.unknown ?? [])}${busy.error ? ` error=${JSON.stringify(busy.error)}` : ""}`,
  );
  const slots = await call("find_time", { duration_minutes: 30, days: 5, max_results: 5 });
  console.log(
    `find_time 30 min: ${slots.slots?.map((s: { start: string }) => s.start).join(", ") || slots.hint || JSON.stringify(slots.error)}; ` +
      `ranges=${slots.ranges?.length}, complete=${slots.complete}`,
  );
  // Other people's free/busy needs calendar.events.freebusy: ask each account about the OTHER one's address,
  // which shows whether the grants carry it (without it: listed under unknown, with the re-consent remedy).
  const addresses: string[] = (listed.calendar?.accounts ?? []).flatMap((a: { address?: string }) => (a.address ? [a.address] : []));
  if (addresses.length) {
    const withThem = await call("free_busy", { days: 1, attendees: addresses });
    console.log(`free_busy attendees ${addresses.join(", ")}: ${JSON.stringify(withThem.attendees ?? withThem.error)}`);
  }

  if (process.argv.includes("--read-only")) {
    console.log("\n--read-only: no write tool called");
    await client.close();
    return;
  }

  const account = process.env["SMOKE_ACCOUNT"] || (await call("list_accounts")).calendar.accounts.find((a: { default: boolean }) => a.default)?.account;
  const bad = await call("create_event", { account, title: "x", start: "tomorrow" });
  console.log("input error shape:", JSON.stringify(bad.error?.kind));

  const made = await call("create_event", {
    account,
    title: `mcp-calendar smoke ${Date.now()}`,
    start: "2027-01-15T10:00",
    reminders_minutes: [],
    busy: false,
  });
  console.log("\ncreate:", JSON.stringify(made.created ? { start: made.created.start, end: made.created.end } : made));
  const ref = { account, calendar_id: made.created.calendarId, event_id: made.created.eventId };

  const moved = await call("update_event", { ...ref, start: "2027-01-15T11:30" });
  console.log("update (keeps the hour):", JSON.stringify(moved.updated ? { start: moved.updated.start, end: moved.updated.end, changed: moved.changed } : moved));

  const got = await call("get_event", ref);
  console.log("get:", JSON.stringify({ title: got.title, reminders: got.reminders, busy: got.busy }));

  const gone = await call("delete_event", ref);
  console.log("delete:", JSON.stringify(gone.deleted ?? gone));

  const after = await call("get_event", ref);
  console.log("get after delete:", JSON.stringify(after.status ?? after.error?.status));

  await client.close();
};

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
