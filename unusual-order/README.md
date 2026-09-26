# Shopgrove: unusual order

A fictional commerce marketing page with a deterministic order simulator and a real contextual Stand Chat conversation. Plain HTML, CSS, and JavaScript; serve this directory over HTTP without installing or building anything.

## Copy

```sh
npx degit standchat/examples/unusual-order my-shopgrove
```

Keep `index.html`, `style.css`, `app.js`, `order-model.js`, both product SVGs, `stand-inline.js`, and `stand-visitor.js` together. `/_shared/` is optional gallery chrome. `og.png` is the real 1200×630 browser capture.

The two Stand files are based on the repository's Stand Inline implementation, so there are no runtime dependencies on sibling examples. Replace both `site="demo"` and `data-stand-id="demo"` in `index.html` with your own public Site ID. The retained installation script's launcher is hidden; the inline visitor client owns this conversation separately. See the [official beta contract](https://stand.chat/guide/custom-chat-ui).

## Order rules

- Grove mugs: $32 each, 1–12 mugs, ready on relative day 0.
- Preorder: adds exactly one $18 saucer, ready day 21. It ships separately from mugs.
- Personalization: $6 per mug, no merchandise discount, mug readiness moves to day 3.
- Wholesale: minimum 6 mugs (quantity automatically increases when needed), 20% off merchandise including the saucer. Removing wholesale keeps the current mug quantity.
- Two destinations: minimum 2 mugs, split evenly with an odd extra mug sent to A. The saucer goes to B. Removing this option consolidates by readiness at A.
- Shipping: $8 per distinct destination/readiness group. There is no combined-shipping option.
- Illustrative tax: 7% of discounted merchandise plus personalization, rounded once to cents. Shipping is untaxed.
- All money is calculated in integer cents. Readiness means planned availability, not dispatch or delivery. No inventory, tax quote, payment, shipment creation, buyer approval, or backend commerce operations are connected.

`order-model.js` is the shared source of calculations and the context sent to Stand. The UI never parses replies into actions. The local inline component adds an opt-in `collapse-order-context` display setting: it shows the visitor question and keeps the exact transmitted snapshot in an accessible disclosure, rendered with `textContent`. Other messages and transport behavior are unchanged. All arbitrary text is rendered as text, with the copied component handling its safe supported message formats.

## Conversations

Editing an exception selects its relevant stage and prepares a question. Visitors can review the snapshot and edit the question before choosing **Send to Stand**. Every submission through the order form includes the current snapshot. Ordinary replies in the inline conversation use the last sent context; order edits are not transmitted automatically. Reset/undo apply to the local order only. Reload recovers the Stand conversation; the local simulator starts at its two-mug default.

Responder discovery runs on load. It does not create a conversation or send the form contents. The first explicit send creates the session. A bounded creation prompt describes the fictional catalog; the visible visitor message includes scenario, stage, selected items, quantities, costs, fulfillment allocation, assumptions, and question. The shared demo connects to Stand's demo AI or an available human, not a Shopgrove team.

The copied client retains disclosure, attribution, notices, handoff cards, email follow-up, reconnection, session recovery, and idempotent message retry. It asks the visitor to decide what to do after an uncertain session creation. Session credentials remain in sessionStorage when available, with in-memory fallback.

## Verify

```sh
node --test unusual-order/order-model.test.mjs
node --check unusual-order/app.js
npm run build
npm run og -- unusual-order
```

Run repository commands from its root. The model checks cover all 192 combinations of quantity and four exceptions, plus exact totals, rounding, allocations, bounds, and context. The page includes a complete How it works walkthrough. The original SVG illustrations and new example code are public domain under the repository's Unlicense.
