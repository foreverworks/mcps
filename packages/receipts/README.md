# receipts

Build an MCP server for a delivery app's order history by writing only what is
that app's own, with `@foreverworks/receipts`. This package is what [Bolt Food receipts](../../servers/bolt-food)
and [Glovo receipts](../../servers/glovo) share: itemised receipts, the join
from a bank card charge to the order it paid for, product search, spending per
store and per month, CSV exports, the order store, configuration from the
environment and a `--health` mode. A server adds its API adapter, its wire
types and their mapping to a receipt, its `list_orders`, and its tools'
wording.

Like `@foreverworks/mcp-kit`, it is a workspace package and not on npm:
`npm run kit` at the root builds both before the servers, which import them
from `dist/`.

## What a server built on it has

**Eight read-only tools**: `health`, `list_orders` (the app's own),
`get_receipt`, `get_receipts`, `match_card_charges`, `search_items`,
`export_items` and `order_stats`. Their policy is `POLICY` from `./mcp`; none
is `money`, and `export_items` writes only into the server's exports folder.

**One meaning of "what an order cost"**, in `order_stats`: the sum of its
`charged` legs (the card, the app's balance or credits, cash), which is why
every key of a receipt's `charged` must be a payment leg. `card` is what the
bank statement shows. Sums stay integer minor units until printed; the average
per order is the one division, rounded once, half up, to the cent. A refund is
not subtracted, because neither app says when one reached the card, and an
order whose legs cannot be read is counted in `unpriced`, never as zero.

**Four variables**, named after the server (`bolt-food` reads `BOLT_FOOD_*`;
`envPrefix` in `./infra` makes the prefix):

| Variable | Required | Meaning |
|---|---|---|
| `<PREFIX>_CREDS` | yes | Path of the app's `credentials.json`. No default: unset, the tools answer a `config` error naming it. |
| `<PREFIX>_TIME_ZONE` | no | The IANA zone local dates are read in (the kit's `timeZoneOf`); unset is the process's zone. Set it to the zone the bank books in. |
| `<PREFIX>_STATE_DIR` | no | Stored order details, under `orders/`; the kit's `stateDirOf` default. |
| `<PREFIX>_EXPORTS_DIR` | no | Where `export_items` writes; default `<state dir>/exports`. |

**A `--health` mode**: one line starting with the server's label, and exit 0
(alive), 1 (a person has to act) or 2 (transient).

## Exports

| Entry | What it holds |
|---|---|
| `@foreverworks/receipts/domain` | Pure rules. Money in integer minor units (`formatMinor`, `parseBankAmount`, `currencyOf`); local dates in a zone given as an argument (`localMoment(epochMs, timeZone)`, `utcDate`, and the kit's `addDays`, `daysBetween`, `isIsoDate`); the range cap (`parseRange`, `inRange`, `MAX_RECEIPT_DAYS`); the card-row join (`matchCharges`, `payableOrder`, `WINDOW`); the item ranking and CSV (`rankItemsBy`, `toCsv`); the order statistics (`orderStats`); when a stored order can be trusted (`settledSince`, `SETTLE_DAYS`); a JWT's claims read without verifying (`jwtClaims`, `jsonObject`); what every receipt has (`ReceiptCore`, `DELIVERED`, `REMOVED`, `keptItemCount`); name filters (`containsIgnoringCase`); and the failures every server shares (`CommonError`: `input`, `not_found`, `config`, made by `inputError`, `notFound`, `configError`, with `fail`, `isCommon`, `commonRemedy` and `joinErrors`). |
| `@foreverworks/receipts/app` | The shared use cases, bound to one app by `makeReceiptUseCases(app)`: `getReceipts`, `searchItems`, `exportItems`, `matchCardCharges`, `orderStats`. The app a server describes (`ReceiptApp`, `CardMatching`, `ReceiptFilter`, `Detail`), the ports the use cases need (`BaseDeps`, `OrderStore`, `FilePort`, `Paths`, `CredentialsFile`, `Written`, `ExportDeps`), and `fetchOne`, `Fetched` and `unreadable`, which report one unreadable order in place and stop a batch on a failure that would fail every row. |
| `@foreverworks/receipts/infra` | The adapters: `resolvePaths(name, env)`, `resolveTimeZone(name, env)` and `envPrefix(name)` (configuration from the environment alone), `credentialsReader(fields)` (a `credentials.json` of string fields, read on every call), `makeOrderStore(dir)` (one 0600 JSON file per settled order, written by rename), `makeFiles()` (exports written whole as 0640 files, reported by path, SHA-256 and size), and `HISTORY_TTL_MS` (five minutes). |
| `@foreverworks/receipts/mcp` | The tool surface: `registerReceiptTools(server, deps, tools)`, the shared argument fields (`localDate`, `detailField`, `stateField`), `POLICY`, and `runServer(spec)`, a server's whole `main` (stdio or HTTP through the kit's `serve`, and `--health`). Types: `ReceiptCopy`, `ReceiptTools`, `StateCopy`, `Handled`, `Zoned`, `ServerSpec`. |
| `@foreverworks/receipts/cli` | `runHealthCli` and its exit codes `OK`, `PERMANENT` and `TRANSIENT`: the `--health` contract. |

## Adding a delivery-app server

Copy `servers/glovo` or `servers/bolt-food`, then change what the steps below
name. The steps every server takes (the search for existing servers,
`package.json`, the changelog, the icon) are in CONTRIBUTING.md's
[Adding a server](../../CONTRIBUTING.md#adding-a-server).

1. **Name.** `src/app/usecases/receipts.ts` exports `NAME` (`"glovo"`): the
   MCP name, the variables' prefix and the export files' prefix.
2. **Wire types and mapping.** `src/domain/schema.ts` holds the app's payloads,
   every field optional. `src/domain/receipt.ts` maps one, given the time zone
   as an argument, to the app's own receipt, which must satisfy `ReceiptCore`
   (order id, state, local date, currency, `charged` with `card` as a decimal
   string and only payment legs beside it, items with `adjustment`). Never
   model an address or a courier: no receipt needs them.
3. **The API adapter** in `src/infra/`, on the kit's `makeHttp`,
   `makeTokenSource` and `makePacer`. The app's own failures go in
   `src/domain/errors.ts`, joined to the common ones by
   `joinErrors(makeErrorKit<OwnError>("<namespace>"))`, with a `remedyFor`, an
   `isSystemic` (which failures stop a batch) and an `auth` kind that says
   whether it is `permanent` (what `--health` reads). Credentials come from
   `credentialsReader({ refreshToken: "refresh_token", ... })`, called with
   `paths.credentials`.
4. **Deps.** `src/app/ports.ts` extends `BaseDeps<Raw, TokenFacts>` with the
   app's port. `src/composition.ts` fills it from `resolvePaths(NAME, env)`,
   `resolveTimeZone(NAME, env)`, `makeOrderStore`, `makeFiles` and the adapter,
   memoises the history for `HISTORY_TTL_MS`, and reads nothing until a tool
   needs it, so the server starts unconfigured.
5. **The use cases.** `makeReceiptUseCases({ name, receiptsInRange, headline,
   itemRows, rankItems, storeOf, matching })` takes: how to find the receipts
   dated in a range (reporting an unreadable order with `fetchOne`), the
   receipt without its lines, one flat row per product line (its keys are the
   CSV's columns), the ranking (`rankItemsBy`), the store an order came from,
   and, for matching, which receipts to read for a window (`filter`), when an
   order happened as far as a card row is concerned (`dated`), and how the
   result names the dates it searched (`searched`).
6. **The tools and the entry point.** `src/mcp/register.ts` calls
   `registerReceiptTools` with the app's words for each description
   (`ReceiptCopy`), its error vocabulary, its `list_orders`, `health` and
   `getReceipt`, and the use cases. `src/index.ts` is one `runServer` call and
   `src/cli/health.ts` one `runHealthCli`:

   ```ts
   runServer({
     name: NAME,
     version: packageVersion(import.meta.url),
     ...packageIdentity(import.meta.url),
     instructions: INSTRUCTIONS, // what a client reads at initialize, in the app's words
     buildDeps,
     register: registerAll,
     healthCheck: runHealthCheck,
   });
   ```

7. **Docs and tests.** A README from CONTRIBUTING.md's template naming the four
   variables, `test/tools.snapshot.json` built with a named zone so it is the
   same on every machine, invented fixtures only, and `scripts/smoke.ts`.

## Design rules

- **The card leg, not the total.** A card row joins an order on the amount the
  card paid (the total minus a balance or credits), exactly, in integer minor
  units and the same currency, with the booking date one day before to two
  days after the order's date, claimed greedily in time order
  (`domain/matching.ts` says why). Rows keep the bank's sign: only a debit
  pairs, and a credit (a refund) is listed apart.
- **Each app decides what "the order's date" is.** Bolt Food uses the local
  date the order was placed; Glovo, which keeps no such time, the UTC date it
  was delivered.
- **Exports never replace each other.** Each is a new file, named for its range
  and the moment it was written.
- **Missing is not zero.** An amount the app did not send stays absent, and an
  order with no card leg or no currency pairs with nothing.
- **One bad order is reported, not thrown.** A dead token or network is thrown,
  because it would fail every row the same way.
- **Raw payloads are stored, once settled.** An order is stored only after a
  week in its final state (refunds land later), as the app's raw payload, so a
  fix to a mapping applies to every stored order.
- **The zone is configuration.** Nothing here assumes one; the domain takes it
  as an argument and the descriptions name it.
