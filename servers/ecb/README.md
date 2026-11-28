# <img src="icons/icon.svg" width="36" height="36" alt="ECB exchange rates icon"> ECB exchange rates MCP server

Look up the [European Central Bank](https://www.ecb.europa.eu)'s euro foreign
exchange reference rates from your AI assistant: the rate in force on any day
since 1999, with the date of the fixing it is; every currency on a day, or a
window of fixings; and exact conversions between any two currencies, cross
rates through the euro included. It only reads: no tool writes or is `money`.
Rates stay the ECB's exact value (`1.1052`, never `1.105`), and every answer
says which fixing it used, so a weekend or a holiday is never a silent guess.

**You need** nothing: no account and no key. The server reads the ECB's public
XML files at `www.ecb.europa.eu`. The ECB publishes these rates "for
information purposes only" and discourages using them for transactions, so a
bank or a card will not give you exactly this rate; they are the standard
reference for statements, bookkeeping and comparisons.

## Use it hosted

Nothing to install: the ECB server is also hosted for anyone, free, with no account and
no key, at

```
https://mcp.foreverworks.com/ecb
```

- **In Claude**: Settings, Connectors, Add custom connector. Give it a name,
  paste the address and add it.
- **In Claude Code**: `claude mcp add --transport http ecb https://mcp.foreverworks.com/ecb`.
- **In other clients** that take a remote MCP server: add the address as a
  Streamable HTTP server, with no authentication.

The hosted server has every tool below: `health`, `rate`, `convert` and `rates`.

The hosted server is rate-limited for each caller, so it suits a person working
with an assistant, not bulk lookups: a call over the limit is refused with a 429
and the seconds to wait. What it sends where, and the rules it is used under, are on the
[privacy](https://foreverworks.github.io/mcps/privacy/) and
[terms](https://foreverworks.github.io/mcps/terms/) pages; for a problem, see
[support](https://foreverworks.github.io/mcps/support/). To install it
yourself, read on.

## What you can ask

- "What was the ECB's euro to dollar rate on 14 March 2025?"
- "Convert an invoice of 1,250.50 GBP dated 3 October 2025 to US dollars at the
  ECB's rate for that day, and show me the rates you used."
- "How many euros was 10,000 Hungarian forint worth today?"
- "Give me the ECB's USD and JPY rates for every working day of September 2025."
- "Which rate did the ECB publish for the Croatian kuna on its last day?"

## Install

<!-- install:begin -->
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect/mcp/install?name=ecb&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40foreverworks%2Fmcp-ecb%22%5D%7D) [![Install in Cursor](https://img.shields.io/badge/Cursor-Install_Server-000000?style=flat-square&logo=cursor&logoColor=white)](https://cursor.com/install-mcp?name=ecb&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBmb3JldmVyd29ya3MvbWNwLWVjYiJdfQ%3D%3D) [![Download for Claude Desktop](https://img.shields.io/badge/Claude_Desktop-Download_Bundle-D97757?style=flat-square&logo=claude&logoColor=white)](https://github.com/foreverworks/mcps/releases/latest/download/mcp-ecb.mcpb)

With Claude Code:

```bash
claude mcp add ecb -- npx -y @foreverworks/mcp-ecb
```

Claude Desktop (Settings, Developer, Edit Config) and most other clients read the same command as JSON:

```json
{
  "mcpServers": {
    "ecb": {
      "command": "npx",
      "args": ["-y", "@foreverworks/mcp-ecb"]
    }
  }
}
```

Each runs the published package on Node 22.19 or newer. It needs no settings.

### From a clone

```bash
git clone https://github.com/foreverworks/mcps.git && cd mcps
npm ci && npm run build
claude mcp add ecb -- node "$PWD/servers/ecb/dist/index.js"
```

In a JSON configuration, the command is `node` and its one argument the full path of `servers/ecb/dist/index.js`. To share one running copy between several clients over HTTP, see [docs/deploying.md](../../docs/deploying.md).
<!-- install:end -->

## Configuration

None of its own. The variables every server shares are in
[docs/configuration.md](../../docs/configuration.md); a process limited by
`MCP_EGRESS_ALLOW` must allow `www.ecb.europa.eu`. Dates are Frankfurt dates
(CET and CEST) whatever the host's time zone, so "today" is today in Frankfurt.

## Tools

Every tool is **read**: it changes nothing.

| Tool | Access | What it does |
|---|---|---|
| `health` | read | Whether the ECB answers: the date of its latest fixing and how many currencies it carries, with a warning when that fixing is more than five days old. |
| `rate` | read | The rate in force on a day (default today): the ECB's fixing of that day or of the last working day before it, as units of the currency per 1 EUR, with the fixing's date (`fixing_date`). |
| `convert` | read | An amount (a decimal string) between any two currencies, the euro included, at the fixing in force on a day, rounded once by the rule you name, with the rate or rates and the fixing's date. |
| `rates` | read | Every currency (or the ones you name) as of one day, or every fixing the ECB published in a window, oldest first, up to 2,000 rates a call. |

## Troubleshooting

**`input`.** The question cannot be answered as asked, and nothing was
fetched: a date after today or before 1999-01-04, a window holding more than
2,000 rates (name fewer currencies or a shorter window), `from` after `to`, or
the same currency on both sides of a conversion. The message names which.

**`not_found`: "the ECB's fixing of ... carries no ... rate; it carries ..."**.
The fixing in force that day has no rate for the currency, and the message lists
the ones it has. The ECB's list changes over time: the Bulgarian lev has no
rate after 2025-12-31, the Croatian kuna after 2022-12-30 and the Russian rouble
after 2022-03-01. No older rate stands in for a missing one, since that would
be a rate from another day under a new date: ask for a day the ECB published
that currency, and use `rates` over a window to see which days those are.

**`api`.** The ECB's server did not answer, even after retries (status 0 is no
connection). Try again in a few minutes.

**`drift`.** The ECB answered with something that is not its rates XML, such as
an HTML page, or the format changed. The server refuses to guess; please report
it.

## How it works

### The source

The ECB publishes three static XML files under
`https://www.ecb.europa.eu/stats/eurofxref/` (read 2026-11-16), each a slice of
one series that changes once per TARGET working day, around 16:00 CET:

| File | Holds | Size |
|---|---|---|
| `eurofxref-daily.xml` | the latest fixing | 1.5 KB |
| `eurofxref-hist-90d.xml` | the last 90 days, 65 fixings | 70 KB |
| `eurofxref-hist.xml` | everything since 1999-01-04, 7,136 fixings | 8.2 MB, 960 KB compressed |

The server reads the smallest file that reaches the day you ask about: the
daily one for today, the 90 days for a recent day, and the history only for a
day older than that. When it does read the history it lays the two small files
over its tail, so a copy cached before today's fixing is never why a window
ends a day early. The two small files are kept five minutes (the ECB serves
them for five) and the history a day. Parsing the history takes about a
quarter of a second and 18 MB of memory (the 2026-11-13 file).

**The files do not agree on style.** The daily file is indented, quotes with
`'` and writes `365.60` for the forint; the other two are one line, quote with
`"` and write `365.6`; and the history lists the newest fixing first. The
server reads both quote styles and drops trailing zeros, so a fixing reads the
same whichever file it came from: the value is the ECB's, digit for digit.
Any answer that is not this document fails as `drift`, never as an empty
period, and so does a rate that is not a positive plain decimal.

**Fetching.** A request is tried up to three times on a 5xx, a 429 or a
dropped connection.

### The rate in force on a day

A day's rate is that day's fixing. A weekend, a TARGET holiday, or today before
the 16:00 CET publication takes the fixing of the last working day before it
(`2026-01-01` takes `2025-12-31`). Every answer carries `fixing_date`, so you
can say which publication you used; today's rate asked before the fixing also
carries a `note` saying so. The rate is whole-fixing: if the fixing in force
does not carry the currency, that is `not_found`, and no older rate stands in.

The euro itself answers `1` in `rate`, so every currency of a fixing has an
answer. A rate is units of the currency per 1 EUR, as the ECB quotes it: `1 EUR
= 1.1052 USD`. The server gives no inverse, because `1 / 1.1052` has no exact
decimal form; `convert` computes it exactly instead.

### Converting an amount

`convert` takes the amount as a decimal string, so `1250.50` reaches the
arithmetic as written. Every conversion is one formula over the rates of one
fixing, where the euro's rate is 1:

- the euro to a currency: amount x rate;
- a currency to the euro: amount / rate;
- two currencies, through the euro: amount x rate(to) / rate(from).

The exact result is rounded once, to `places` (0 to 8, default 2), half up
(halves away from zero, as invoices round) unless `rounding` is `half-even`.
No rate is rounded on the way: a cross rate such as GBP to USD is not a
rounded GBP-to-EUR step followed by a rounded EUR-to-USD one. The answer
carries the rate or rates, their fixing's date, the rule, and a `meaning` line
to paste into a document: "100 GBP = 132.27 USD at the ECB fixing of
2026-11-13: 1 EUR = 0.83559 GBP and 1 EUR = 1.1052 USD; 100 x 1.1052 /
0.83559, a cross rate through the euro, rounded half-up to 2 places".

### Several rates at once

`rates` answers fixings, oldest first, each with its date and a `rates` object
of currency to units per 1 EUR. With `date` (or nothing, for today), it holds
the one fixing in force that day, all currencies from it, dated by
`fixing_date`. With `from` and `to` (default today), it holds every fixing in
the window, both ends included, or none and a note saying so. Name currencies to
narrow either answer. A window is limited by size, not by length: 2,000 rates
a call (about a year of seven currencies, or every currency for about three
months), so the answer stays readable. A currency you named that the ECB did not
publish anywhere in the window is listed in `absent`; one missing from a day's
fixing is missing from that fixing's `rates`.

## Limitations

- **The ECB's reference rates only**, once per working day and for information:
  no intraday rates, no buy and sell spread, and not the rate a bank or card
  gives.
- **About thirty currencies**, the ones the ECB publishes: 29 on 2026-11-13,
  and 41 codes over the series, the ones that left (the lev, the kuna, the
  rouble, the old lira, leu and tolar among them) only on the days they were
  published.
- **From 1999-01-04**, the euro's first working day.
- **No inverse or percentage change fields**, which would not be exact
  decimals; `convert` and your own arithmetic on the exact rates are.
- **The history is kept a day**, which only matters if the ECB corrects a rate
  older than 90 days; the next day's read then has it.

## Other servers for the ECB

Searched 2026-11-16 on the MCP Registry, npm and GitHub. The ECB publishes no
server of its own that we found. Community servers exist, most reading the same
data through a third party:

- **`@mrfentmen/ecb-mcp`** on npm (1.0.1, 2026-10): three tools, the latest
  rate of one currency, its recent history and the ECB policy rate, from the
  ECB's SDMX Data Portal. Its inverse rate goes through a JavaScript number and
  `toFixed(6)`; it has no conversion and no date lookup.
- **`frankfurter-mcp`** on npm (1.0.2, 2026-10) and several others
  (`@pipeworx/mcp-frankfurter`, `lineofflight/frankfurter-mcp`, ...) wrap
  Frankfurter, a hosted service that republishes exchange rates. The one read
  here converts with a JavaScript number and rounds through `toLocaleString`.
- **`@cyanheads/exchange-rates-mcp-server`** on npm (0.6.0, 2026-11), the most
  complete: Frankfurter v1 rates from 1999, cross rates through the euro with no
  intermediate rounding, and SQL over staged series. It returns the converted
  amount as an unrounded JavaScript number and applies no rounding rule.
- **`@pipeworx/mcp-ecb`** on npm (0.2.1, 2026-11), through the Pipeworx
  gateway, and `scka-de/ecb-mcp` and `mohammad-abbasi-sh/ecb-mcp` on GitHub:
  the ECB Data Portal's statistics (exchange rates, interest rates, inflation
  and more), by their own descriptions, not converters.
- **`@allratestoday/central-bank-mcp`** on npm (0.3.18, 2026-11): 130 central
  banks through AllRatesToday's hosted API; dated tables and history need a
  paid plan.

Libraries on npm, such as `ecb-euro-exchange-rates` and `ecb-exchange-rate`,
give the same rates without MCP.

This one exists for what none of them does together: it reads the ECB's own
files, from where its caller runs, with no third party in between and no key; it
keeps every rate as the ECB wrote it; it answers the rate in force on any day
since 1999, weekends, holidays and the hours before 16:00 CET included, and
always says which fixing it used; and it converts between any two currencies,
cross rates included, in exact decimals, by a named rounding rule, saying every
rate it used.
