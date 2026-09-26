# Meterwick subscription lab

A fictional billing product with a deterministic September timeline, itemized illustrative invoice, and contextual Stand Chat conversation. Plain HTML, CSS and JavaScript; serve this folder over HTTP. Consumers need no installation or build step.

## Copy

```sh
npx degit standchat/examples/subscription-lab my-billing-lab
```

Keep the six runtime files together: `index.html`, `style.css`, `app.js`, `billing.js`, `stand-inline.js`, and `stand-visitor.js`. `/_shared/example.css` and `/_shared/example.js` are optional gallery chrome. The page has its own fallback explainer styles. Fonts have local sans-serif fallbacks.

Replace both Site IDs: `data-stand-id="demo"` on the Stand script and `site="demo"` on `<stand-inline>`. Get your own installation snippet from Sites in Stand. The demo uses Stand Chat's AI Stand-in on any domain and does not appear in your account.

## Billing model

- 30-day September in USD, initially Launch ($90) plus 3 seats ($10 each): $120/month.
- Scale is $180 plus seats. A seat event adds two seats. Changes apply at the start of their day; same-day changes follow insertion ID order. Maximum 12 events.
- An adjustment is `(new monthly rate − previous monthly rate) × (31 − day) / 30`. The model carries integer cents-times-days, rounds the running subtotal, and shows the difference on each line. This equals the rounded sum of each day's service and prevents repeated rounding drift.
- Pause stops all charges and retains the setup. Upgrades/seats while paused change the setup; resume restores its rate. Cancel is terminal. Later service changes are ignored.
- Payment failure changes collection status only. The lab never attempts collection. No taxes, discounts, automatic retries, next-month billing, or backend accounts.
- Undo keeps the last 40 local edits. Reset restores the starting subscription and keeps the chat. Scenario and chat recovery use tab-scoped session storage when available.

## Stand integration

`stand-inline.js` and `stand-visitor.js` are copied from the repository's public-domain inline example so the folder is standalone. The component adds a `prepareMessage(question)` callback that snapshots context at the deliberate send action, before waiting for discovery. `app.js` supplies it using `contextualMessage()`. A second small addition renders the attached scenario as an expandable plain-text snapshot in pending, live and restored messages, so it does not bury the question or reply.

The question and full scenario travel as ordinary supported visitor text: `initialMessage` for session creation, `body` for subsequent messages. This avoids relying on the initial prompt's size limit or implying that replies can change the page. Context is visible under “Review the scenario sent with your question.” An old attached snapshot in a recovered draft is replaced on the next deliberate send; retries of pending messages keep their original payload and ID.

The client implements responder discovery, explicit session creation, canonical transcript rendering, WebSocket reception, reload recovery, bounded reconnect, idempotent pending-message retries, uncertain-start handling, AI/human identity changes, configured notices and attribution, link cards, and email follow-up offers. Discovery does not create a conversation. Selecting/editing a scenario does not send it. Transcript text uses safe rendering; no AI output is executed or used as billing state.

Contract: [Stand custom chat UI](https://stand.chat/guide/custom-chat-ui) (beta). Plan entitlements, quotas and attribution still apply. Human routing and follow-up must be tested with a configured real site; the demo has an AI responder only.

## Verify

```sh
node --test subscription-lab/billing.test.mjs
npm run build
npm run og -- subscription-lab
```

The arithmetic tests include 2,000 seeded scenarios checked against an independent daily ledger, boundary days, stable same-day ordering, no-op changes, terminal cancellation, paused plan/seat changes, payment failure, input validation, line sums, and snapshot replacement. From a copied folder, run `node --test billing.test.mjs` with a current Node version.

Browser checks should cover drag/drop, keyboard timeline navigation and buttons, touch date selection, undo/reset, selection and context, actual demo chat, reload recovery, unavailable/error states, and narrow layouts. `og.png` is a 1200×630 capture of the finished page.

Public domain under the repository's Unlicense. Stand Chat's branding is excluded.
