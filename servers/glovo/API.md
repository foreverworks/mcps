# Glovo: notes on the web app's API

Glovo documents none of this. These notes come from watching the signed-in web
app at https://glovoapp.com (version 1.2718.0, API version 14) and the orders
it returned. Glovo can change any of it without notice.

## Client

Every call goes to one host:

    https://api.glovoapp.com

## Auth

- `POST /oauth/refresh`, with the body `{"refreshToken": "<refresh token>"}`
  and the headers `content-type: application/json`, `glovo-app-platform: web`,
  `glovo-app-type: customer` and `glovo-device-urn: <urn>`. It answers
  `{accessToken, expiresIn: 1198, refreshToken, tokenType: "bearer"}`.
- **The refresh token does not rotate**: the answer carries the same one, still
  valid, so refreshing is safe to repeat and does not sign the browser out. The
  answer is a credential: never log it.
- The refresh JWT's claims are
  `{iat, iss: "auth", role: "REFRESH", version: "V2", jti, payload}`, where
  `payload` is a JSON string holding `{userId, deviceId, grantType}`. There is
  no `exp`.
- The access token lives about 20 minutes and goes raw in `authorization`,
  without a `Bearer ` prefix, as the web app sends it. A bad one answers
  `401 {"errorCode": "invalid_token"}`.
- `/oauth/revoke` is the sign-out. Never call it.

Every API call carries `accept: application/json`,
`authorization: <access token>`, `glovo-app-platform: web`,
`glovo-app-type: customer`, `glovo-api-version: 14`,
`glovo-language-code: en` and `glovo-device-urn: <urn>`. The language sets the
wording of every display string; the parsers read English and accept Romanian.

## The two endpoints that matter

### Order list: `GET /v3/customer/orders-list?offset=0&limit=15`

Newest first, at most 15 orders a page whatever `limit` asks. The body is
`{pagination: {currentLimit, next: {offset}}, orders: [...]}`. `next.offset` is
the page's last order id and goes back as `offset`; `next` is null at the end.
Order ids decrease strictly down the list.

A row is a display card: `orderId`, `orderUrn`, `content.title` (the store),
`content.body[0].data` (a product summary), `footer.left.data` and
`layoutType` (`ACTIVE_ORDER` or `INACTIVE_ORDER`). **No date, no state, no
payment.** The footer is the order's total (it matched the detail's TOTAL on
every order compared) or a word: "Cancelled" or "Refunded" (Romanian "Anulat",
"Rambursat").

### Order detail: `GET /v3/customer/orders/{orderId}`

An unknown id answers `404 {"errorCode": "not_found"}`. The fields this server
reads:

- `id`, `code`, `storeId`, `storeName`, `vertical` (`FOOD` or `Q_COMMERCE`),
  `refunded`, and `scheduledTime` (epoch milliseconds, on a scheduled order).
- `currentStatus.type`: `DeliveredStatus`, `CanceledStatus` or
  `ProgressStatus`. `currentStatus.creationTime` is the epoch-millisecond time
  of that status. **The top-level `creationTime` (when the order was placed)
  was null on every order read**: there is no order-placed time anywhere.
- `pricingBreakdown.lines[]`: `{type, description, amount, finalAmount,
  amountPrefix, note}`. The types seen are `DELIVERY` ("No cost" under Prime),
  `PRODUCTS`, `COURIER_TIP`, `SERVICE`, `WEATHER_SURCHARGE`,
  `MIN_BASKET_SURCHARGE`, `DISCOUNT` (negative, with `amountPrefix` a label
  holding the percentage, such as "-30%") and `TOTAL`. An order in progress
  says "Estimated total". `finalAmount` was null on every line.
  `summaryBreakdown` repeats these lines and the payment legs.
- `paymentMethodsBreakdown[]`: `{type, provider, text, amount}`. `amount` was
  always null; the amount, when there is one, is in `text`.
- `boughtProducts[]`: `{name, quantity: "2x", price (the line total),
  originalPrice, promotionDescription, customizationsDescription, notice,
  packaging, displayStyle, freeProduct}`. On a cancelled order `price` is null.
- `headerNotice {style, text}` on an order with a problem, with `<b>` markup.
- `points[]` hold the pickup and delivery addresses (the customer's home) and
  the courier's door notes. The server never surfaces them, and
  `src/domain/schema.ts` does not model them.

Amounts are display strings in Romanian format whatever the language:
`"25,40 RON"`, `"1.234,56 RON"`, `"-12,30 RON"`, and words for zero: "No cost"
(Romanian "Fără costuri") and, as a free product's price, "GRATUIT".

## What the receipt numbers mean

`src/domain/receipt.ts` and `src/domain/receipt/payments.ts` are built on these
facts, observed in Romanian, with English copies of the edge cases.

- **The price lines add up to the total** on every delivered order. Unlike
  Bolt's, they are arithmetic.
- **Product lines do not always add up to the PRODUCTS line** (deposits,
  weighed goods, promotions), and a promoted line can carry a negative line
  price, such as "-3,00 RON" for a pack whose original price is "12,00 RON".
  Treat item prices as display.
- **Payment legs.** A single-leg order states no amount: "Was charged on your
  card ending in NNNN" (Romanian "A fost debitat de pe cardul tău cu terminația
  NNNN"), and that leg paid the whole total. A split order states each leg,
  such as "45,20 RON was charged on your card ending in NNNN." and "5,00 RON
  was paid with Glovo credits" (Romanian "... a fost plătit cu credite Glovo");
  every split seen was a card plus credits. `OTHER` legs read "Paid with Apple
  Pay" (a card) or "Paid with Cash" (Romanian "Plătit cu Numerar", not a card).
  An order in progress says "Will be charged on your card ending in NNNN"
  (Romanian "Se va debita de pe cardul tău care se termină cu"). By these
  rules the legs add up to the total on every delivered order.
- **A cancelled order** usually has no legs and no TOTAL line. It can still
  carry a card leg reading "Was charged" and a TOTAL; the server treats such an
  order as charged (and presumably refunded).
- **A delivered order can be refunded**: `refunded: true`, "Refunded" in the
  list's footer, and a header notice such as "We refunded you 12,50 RON because
  the order couldn't be delivered." for part of the total.
- **Picker changes.** The dropped line has `displayStyle: STRIKETHROUGH` and
  the notice "Not available", an em dash (U+2014), then "you weren’t charged",
  with a typographic apostrophe (U+2019); in Romanian, "Indisponibil", the same
  dash, then "nu ai fost taxat". Its substitute has the notice
  "Instead of <original>" (Romanian "În loc de <original>").
- **The list's order and time.** Down the list (by order id) the status time
  is not strictly in order, but never out of order by anywhere near a day, so
  a walk by date stops safely one day past its start.

## Rate limit

HTTP 429 with `{"statusCode": 429, "errorCode": "too_many_requests"}`. A burst
of list pages back to back trips it. Detail calls one at a time, about 700 ms
apart, mostly do not, though a long run still meets an occasional 429 or 500.
The server's pacing follows from this
([Stored orders and pacing](README.md#stored-orders-and-pacing)).

## Joining to a bank statement

Romanian card rows name Glovo as `Glovo`, `Glovoappro S.r.l.`,
`Glovoappro Srl`, `Glovo <day><month> <code>` (such as `Glovo 14mar ...`) and,
in some statement exports, `Glovo | Categorie: Merchant`. A `Glovo Prime` row
is the monthly Prime subscription, not an order. How a row pairs with an order
is in [Matching card rows](README.md#matching-card-rows).
