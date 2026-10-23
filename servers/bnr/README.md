# <img src="icons/icon.svg" width="36" height="36" alt="BNR exchange rates icon"> BNR exchange rates MCP server

Look up the National Bank of Romania's reference exchange rates from your AI
assistant: the rate in force on any day since 2005, with the date
[BNR](https://www.bnr.ro) published it; amounts converted to or from RON;
several currencies or a window of fixings at once; and the yearly average ANAF
converts foreign income at in the D212. It only reads: no tool writes or is
`money`. Rates stay BNR's exact text (`4.2440`, never `4.244`).

**You need** nothing: no account and no key. The server reads BNR's public
XML files at `curs.bnr.ro`.

## What you can ask

- "What was BNR's euro rate on 14 March 2025?"
- "Convert an invoice of 1,250.50 EUR dated 3 October 2026 to lei, at the
  last rate BNR published before that date."
- "How much is 10,000 HUF in RON today?"
- "Give me BNR's EUR and USD rates for every banking day of September 2026."
- "Which annual average USD rate goes into my D212 for 2025?"

## Install

<!-- install:begin -->
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect/mcp/install?name=bnr&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40foreverworks%2Fmcp-bnr%22%5D%7D) [![Install in Cursor](https://img.shields.io/badge/Cursor-Install_Server-000000?style=flat-square&logo=cursor&logoColor=white)](https://cursor.com/install-mcp?name=bnr&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBmb3JldmVyd29ya3MvbWNwLWJuciJdfQ%3D%3D) [![Download for Claude Desktop](https://img.shields.io/badge/Claude_Desktop-Download_Bundle-D97757?style=flat-square&logo=claude&logoColor=white)](https://github.com/foreverworks/mcps/releases/latest/download/mcp-bnr.mcpb)

> [!NOTE]
> `@foreverworks/mcp-bnr` is not on npm yet: the buttons and the `npx` commands below work once it is published. Until then, [run it from a clone](#from-a-clone).

With Claude Code:

```bash
claude mcp add bnr -- npx -y @foreverworks/mcp-bnr
```

Claude Desktop (Settings, Developer, Edit Config) and most other clients read the same command as JSON:

```json
{
  "mcpServers": {
    "bnr": {
      "command": "npx",
      "args": ["-y", "@foreverworks/mcp-bnr"]
    }
  }
}
```

Each runs the published package on Node 22.19 or newer. It needs no settings.

### From a clone

```bash
git clone https://github.com/foreverworks/mcps.git && cd mcps
npm ci && npm run build
claude mcp add bnr -- node "$PWD/servers/bnr/dist/index.js"
```

In a JSON configuration, the command is `node` and its one argument the full path of `servers/bnr/dist/index.js`. To share one running copy between several clients over HTTP, see [docs/deploying.md](../../docs/deploying.md).
<!-- install:end -->
## Configuration

None of its own. The variables every server shares are in
[docs/configuration.md](../../docs/configuration.md); a process limited by
`MCP_EGRESS_ALLOW` must allow `curs.bnr.ro`. Dates are Bucharest dates
whatever the host's time zone, so "today" is today in Bucharest.

## Tools

Every tool is **read**: it changes nothing.

| Tool | Access | What it does |
|---|---|---|
| `health` | read | Whether BNR answers: the date of its latest fixing and how many currencies it carries, with a warning when that fixing is more than five days old. |
| `rate` | read | The rate in force on a day (default today): BNR's fixing of that day or of the last banking day before it, with its date (`published_on`) and multiplier. |
| `convert` | read | An amount (a decimal string) to or from RON at the rate in force on a day, or the last one before it, rounded once by the rule you name, with the rate and its date. |
| `rates` | read | Several currencies' rates in force on one day, or every fixing BNR published in a window of up to 366 days, as one series per currency. |
| `annual_average` | read | A year's average as ANAF uses it: the mean of BNR's twelve monthly averages, with them and their day counts. |

## Troubleshooting

**`input`.** The question cannot be answered as asked, and nothing was
fetched: a date after today or before 2005, a window over 366 days or 2,000
rates (name fewer currencies or a shorter window), or a conversion with no RON
side (convert twice and state both rates). The message names which.

**`not_found`: "BNR publishes no ... rate here; it publishes ..."**. BNR does
not publish that currency; the message lists those it does.

**`not_found`: "BNR has no rates file for ... yet"**. A year's file appears
with its first fixing, so in the first days of January the new year has no
rates of its own: `rate` and `convert` take December's last, but `rates` over
a window in the new year and its `annual_average` wait for that first fixing.

**`api`.** BNR's server did not answer, even after retries (status 0 is no
connection). Try again in a few minutes.

**`drift`.** BNR answered with something that is not its rates XML, such as
an HTML page or a changed format. The server refuses to guess; please report
it.

## How it works

### The source

BNR publishes static XML at `curs.bnr.ro`, the host its "Curs XML" page names
(read 2026-10-18): `/nbrfxrates.xml` is the latest fixing, and
`/files/xml/years/nbrfxrates<year>.xml` every fixing of a year, the current
one included (about 300 KB). A rate is RON per unit, or per 100 units (its
`multiplier`) for HUF, JPY, KRW and a few others.

**The old `www.bnr.ro` addresses answer with the HTML home page and status
200**, which a reader that checks only the status takes for a year with no
rates. Here any answer that is not BNR's rates document fails as `drift`, and
so does a rate that is not a plain decimal.

**Fetching.** A past year's file never changes, so it is fetched once per
process. The current year's and the latest fixing are kept ten minutes, as is
a file first read while its year was current, so a year's average is re-read
from the final file once the year ends. A request is tried up to three times
on a 5xx, a 429 or a dropped connection.

### The rate in force on a day

BNR fixes its rates once per banking day, around 13:00 Bucharest. A day's rate
is that day's fixing; a weekend, a public holiday, or today before the fixing
takes the last fixing before it (in early January, December's last). Every
answer carries `published_on`, the date of the fixing it gave, so you can say
which publication you used; today's rate asked before the fixing also carries
a `note` saying so.

### Converting an amount

`convert` takes the amount as a decimal string, so `1250.50` reaches the
arithmetic as written. To RON is amount x rate / multiplier; from RON is
amount x multiplier / rate (`10000` HUF at `1.2354` per 100 is `123.54` RON).
The exact result is rounded once, to `places` (0 to 8, default 2), half up
(halves away from zero, as invoices round) unless `rounding` is `half-even`.
`rate_rule` picks the fixing, and the answer says which it took:

- `in_force` (the default) is the rate `rate` answers: the day's fixing, or
  the last banking day's.
- `last_before` is the last fixing strictly before the day. Romania's Fiscal
  Code converts a foreign-currency invoice at "the last exchange rate
  communicated by BNR before" the date the VAT is due, so an invoice dated
  Friday takes Thursday's fixing, and one dated Monday Friday's.

The answer carries the rate as BNR wrote it, its multiplier, its date and a
`meaning` line to paste into a document: "100 EUR = 509.10 RON at BNR's EUR
rate 5.0910 RON for 1 EUR, published on 2026-10-16 (in force on 2026-10-16),
rounded half-up to 2 places".

### Several rates at once

`rates` answers one series per currency (up to 50 named, or every one BNR
published), each with its multiplier and its fixings, oldest first. With
`date` (or nothing, for today), a series holds the rate in force that day,
dated by its fixing; with `from` and `to` (default today), every fixing in the
window, both ends included, or no series and a note saying so. A window is at
most 366 days and 2,000 rates (about a year of seven currencies, or every
currency for two months), so the answer stays readable. A currency BNR
published, but not in the window, is listed in `absent`; one it never
published in the years read is refused, with the codes it does publish.

### The annual average

The D212 converts foreign income at "cursul de schimb mediu anual comunicat de
Banca Naţională a României". BNR's published annual average ("Serii anuale -
valori medii") is the mean of its twelve monthly averages (each the mean of
the month's daily rates) at four places, not the mean of the year's daily
rates (USD 2022: 4.6885 against 4.6923). The server computes each monthly
mean and the annual mean in exact decimals, each rounded once, half up, to
four places.

That matches BNR's published values for USD 2020 (4.2440), 2021 (4.1604), 2022
(4.6885) and 2023 (4.5743), and EUR 2022 (4.9315), whether or not the monthly
means are rounded first. A year not over yet answers the months so far with
`complete: false`. `npx tsx scripts/smoke.ts` repeats the USD check against
the live files.

## Limitations

- **BNR's reference rates only**, not the ECB's or commercial banks'.
- **From 2005**, when BNR's XML series start.
- **No cross rates.** BNR publishes no rate between two other currencies, so
  one side of a conversion is RON.
- **A multiplier change within a month fails the annual average** as `drift`,
  rather than averaging that month on two bases; none has happened in the
  files read. A change between months answers with a `warning`.

## Other servers for BNR

Searched 2026-10-18. BNR publishes none, and one community server exists:

- **`@pipeworx/mcp-bnr-ro`** on npm (0.1.2, 2026-09), served through the
  Pipeworx gateway beside about 30 shared meta-tools. Its two tools return the
  latest fixing or a year's fixings, each rate a JavaScript number (`4.2440`
  arrives as `4.244`); neither picks the rate in force on a day or computes
  the annual average.

A second search, on 2026-10-21, found two more that convert an amount to RON:

- **anafpy's MCP tools** on PyPI.
- **`bnr-converter-mcp-server`** on PyPI, which also takes the last rate
  before a date, but takes the amount as a Python float and rounds through
  one.

Libraries read the same XML without MCP: `curs-bnr`, `bnr-exchange-rate` and
others on npm, `bnrxrate` and anafpy's BNR client on PyPI, and
`itrack/cursbnr` and `peterlupu/curs-bnr` on Packagist.

This one exists for what none of them does: it reads BNR directly, from where
its caller runs; it keeps every rate as BNR wrote it; it answers the rate in
force on any date, weekends, holidays and the hours before 13:00 included; it
converts in exact decimals by a named rounding rule; and it computes the
annual average as BNR publishes it and ANAF uses it.
