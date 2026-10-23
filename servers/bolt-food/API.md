# Bolt Food: notes on the web app's API

Bolt documents none of this. These notes come from watching the signed-in web
app at https://food.bolt.eu (version `FW.1.117`) and the orders it returned.
Bolt can change any of it without notice.

## Client

The web app is the React Native app compiled for the web (Expo Router; its
bundle is `_expo/static/js/web/index-*.js`). Every backend call goes to one
host:

    https://deliveryuser.live.boltsvc.net

There is no GraphQL and no HTML to scrape: every screen is a JSON call.

Every request, GET and POST alike, carries the same query parameters:
`version`, `language`, `session_id`, `device_name`, `device_os_version`,
`deviceId` and `deviceType`. Bolt does not seem to check them closely, but the
server sends them as the app does (`src/infra/boltApi.ts`). `distinct_id` is
analytics only.

Every answer is an envelope, `{code, message, data}`, nearly always with HTTP
200: the body's `code` is the real status, and 0 is success.

## Auth

- Calls carry `Authorization: Bearer <access token>`. The access token is an
  HS256 JWT with the claims `{data: {user_id, user_login_id}, iat, exp}`, and
  `exp` is `iat` plus 3600: it lasts one hour.
- The API uses no cookies; the only cookies on the domain are analytics.
- The long-lived credential is a refresh token, a JWT that lasts about a year.
  The app keeps it in MMKV storage inside `localStorage` (the `mmkv_9$a_*`
  keys), each character XORed with 24 so it does not read as plain text; the
  README's console snippet undoes that.
- The token endpoints, on the same host:
  - `POST /profile/eater/auth/authenticate` gives a `refresh_token` (signing
    in).
  - `POST /profile/eater/auth/getAccessToken` with `{refresh_token}` (the
    server also sends it as the bearer) gives `{access_token,
    expires_timestamp}`. It leaves the refresh token as it was, so it is safe
    to repeat.
  - `POST /profile/eater/auth/rotateRefresh` gives a new refresh token. It
    invalidates the old one and signs the browser out, so the server never
    calls it.

## The two endpoints that matter

### Order list: `GET /deliveryClient/getOrderHistory`

Query: `page_size` (an integer; the server asks for 50) and `page_token`
(opaque, the previous page's `next_page_token`). Newest first. `data` is
`{orders, next_page_token}`, and one order summary is:

    order_id, order_reference_id, order_state (delivered|failed|rejected), order_status{value},
    order_type, delivery_type, order_created_timestamp, order_final_state_transition_timestamp,
    provider_id, provider_name{value}, provider_slug, provider_image, city_id,
    delivery_lat, delivery_lng, courier_name, price{value, currency, price_str}, is_ratable

**There are no line items here**: a row is the restaurant and a price.

### Order detail: `POST /deliveryClient/v2/getOrderDetails`

Body: `{order_id, city_id}`. `city_id` is required; take it from the history
row.

The products are at `data.user_baskets[].items[]`:

    menu_item_id, name{locale,value}, amount (qty), user_note,
    unit_item_price  {value, currency, price_str, original_price{...}, discount_percent, modifiers[]}
    total_item_price {same shape}
    options[] -> {menu_item_id, name{value}, amount, unit_item_price, total_item_price}
    adjustment (null unless a picker changed the line)

The rest of the answer is the receipt: `total_price`, `total_item_price`,
`delivery_price`, `total_price_components[]` (subtotal, service fee, tips,
delivery and each Bolt Plus discount, as labelled rows), `payment_methods[]`,
`refund_amount`, `order_refund_state` and `info_boxes[]`. It also holds
`delivery_address`, `provider_address` and `courier`, which the server never
reads (`src/domain/schema.ts` leaves them out).

A price comes both as a number (`value`) and preformatted (`price_str`, with a
decimal comma). `original_price` is the price before a discount, so a line's
discount can be recovered.

### Endpoints not worth using here

- `POST /deliveryClient/v2/getOrdersByIds`, body
  `{orders: [{id, delivery_lat, delivery_lng}], reason}`: live tracking for
  active orders, not a batch read of the history. There is no batch call for
  line items.
- `GET /deliveryClient/getProviderOrderHistory`: one restaurant's history, in
  the same summary shape.
- `POST /deliveryClient/v2/createBasketFromOrder`: what the "Order again"
  button calls.

## Rate limit

`getOrderDetails` throttles with HTTP 200 and
`{code: 1005, message: "TOO_MANY_REQUESTS"}` in the body, not with a 429.
Several workers in parallel were throttled often; one call at a time, 350 ms
apart, with a backoff on 1005, completes cleanly. `getOrderHistory` at
`page_size=50` was never throttled.

## What the receipt numbers mean

`src/domain/receipt.ts` is built on these facts.

- **`payment_methods[]` is what was taken.** The types seen are `card` and
  `bolt_credit` (titled "Bolt Balance"). The card leg is the amount on the bank
  statement.
- **`total_price` can be more than the payments.** On some grocery orders a
  picker replaced or dropped items after checkout, `info_boxes` says "Item
  prices and quantity were updated", the legs add up to less, and
  `total_price` is never corrected. Such an order can also carry
  `refund_amount` with `order_refund_state: partially_refunded`.
- **`total_price_components[]` does not add up to `total_price`.** "Discount"
  and "Bolt Plus discount" restate item discounts already inside "Subtotal",
  and "Packaging fee" is sometimes inside it too. Treat the list as Bolt's
  display, not as arithmetic.
- **The history row's `price` leaves out the courier tip**, so it often differs
  from the detail's total.
- **Item adjustments.** `items[].adjustment` is null unless a picker changed
  the line. The dropped original has `is_strike_through_adjusted_item: true`;
  its substitute has `original.text.text.value` set to "Replacement".
- **Amounts are floats.** Two legs of 2.35 and 57.84 add up to
  60.190000000000005, so the server rounds each amount to whole cents as it
  arrives.

## Joining to a bank statement

On Romanian bank statements, Bolt Food is `Bolt Services Ro S.r.l.`. Rides are
billed as `Payu*bolt.eu/ro`, `Bolt.euNNNNNNNNNN` and `Bolt.eu/o/NNNN`, and are
not in this API. The card leg, not the order total, is what joins a row: the
total misses every order part-paid from Bolt Balance and every grocery order a
picker changed. How a row pairs with an order is in
[Matching card rows](README.md#matching-card-rows).
