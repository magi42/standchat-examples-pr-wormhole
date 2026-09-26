# Launchmere launch simulator

A fictional infrastructure marketing site with a deterministic launch-hour model and an in-context Stand Chat conversation. Plain HTML, CSS, and JavaScript; no consumer dependencies or build step.

## Run or copy

From this repository, run `npm start` and open `/launch-simulator/`. To copy:

```sh
npx degit standchat/examples/launch-simulator my-launch-simulator
```

Serve the copied directory with any static HTTP server. Keep the six runtime files together: `index.html`, `style.css`, `app.js`, `model.js`, `stand-inline.js`, and `stand-visitor.js`. `og.png` is the social image. The two `/_shared/` head references provide only the repository's example bar and copy buttons; remove them when using the folder elsewhere. Local styles and all functionality work without those files. Fonts load from Google Fonts with system fallbacks. The logo and diagram are original CSS/HTML.

Replace `SITE_ID = 'demo'` in `app.js` and `data-stand-id="demo"` in the HTML with your registered Stand Site ID. Configure your real domain and responders in Stand. The demo uses Stand Chat's shared AI and does not write to your account. The standard script remains for repository chrome; its separate floating UI is hidden. The inline conversation uses the documented HTTP/WebSocket visitor API directly.

## Interaction and context

- Choose an app, traffic rate, and scenario. Try the three presets, caching, and a spending guardrail. Reset restores only the simulator; it does not end a conversation or replace its selected snapshot.
- Every cost line and resource card opens an inline review panel. Opening it performs discovery, not session creation. The visitor reviews a frozen snapshot, writes a question, and chooses Send.
- The snapshot includes selected item, scenario, assumptions, rates, resource demand, mitigation, and bill. It travels in the supported session `prompt` (under 2,000 characters) and as quoted text attached to the next visitor message. Selecting another scenario during an active conversation attaches it to the next message using the same ordinary text API. Follow-ups are unmodified.
- Simulator edits do not silently update the snapshot. “Use current scenario” explicitly replaces it. Removing the attachment also removes the initial prompt and remains removed on reload. Context and UI inputs are stored in tab-scoped session storage; storage failure falls back to memory.
- The copied visitor client retains conversation tokens, canonical transcript recovery, idempotent message retry, uncertain-start protection, AI/human disclosure, safe Markdown/link rendering, notices, attribution, handoff cards, and email follow-up forms. Closing the panel leaves the session alive; End chat explicitly ends it.
- AI replies are advisory text only. They cannot execute code, change calculator inputs, provision infrastructure, or enforce a budget. There are no simulated responder messages in the product.

`stand-visitor.js` is copied from this repository's `stand-inline` example. The local `stand-inline.js` copy has two small adaptations: a 2,000-character quote limit for complete snapshots, and a `stand-inline-quote-remove` event so the page can clear its session prompt when the visitor removes an attachment. An explicit offline slot supplies availability/error feedback and manual retry.

Protocol reference: [Stand custom chat UI contract (beta)](https://stand.chat/guide/custom-chat-ui).

## Model and limitations

Everything is fictional USD for one constant 3,600-second hour. There are no real prices, benchmarks, invoices, or provider promises. Rates and profiles are exported from `model.js` and explained on the page.

1. Bot mode adds 2× base traffic, for 3× total, with the same request mix.
2. The budget fraction is `clamp((budget - base - ingress) / uncappedVariableCost, 0, 1)`. This fraction admits traffic before caching. Fixed and ingress charges always remain, even if they exceed the budget.
3. Cache hits are 80% of each profile's cacheable share. Only misses use origin CPU and database operations; all admitted requests transfer the assumed response size.
4. CPU demand is origin requests/second × CPU milliseconds ÷ 1,000. Compare it with 8 reference cores. Database demand is origin requests/second × operations, compared with 12,000 reference ops/second. Above 100% is a capacity mismatch, not a failure or latency prediction. Capacity does not auto-scale or throttle the model.
5. AI-heavy mode makes every origin request an AI call at 3× the invented per-call rate. It does not change local CPU/DB work. No token-length model is implied.
6. Sum costs without intermediate rounding; format for display only. Rounded lines may differ from the total by a cent. Decimal GB, no taxes, latency, burst curves, queues, retries, storage or real bot protection are modeled.

## Verification

```sh
node --test launch-simulator/model.test.mjs
npm run build
npm run og -- launch-simulator
```

The seven calculation tests include independently calculated expected bills, cache/transfer separation, bot multiplication, AI rates, unavoidable cost floors, input bounds, and conservation/context-size checks over 432 scenario combinations. The repository OG script captures a real 1200×630 browser screenshot centered on the completed simulator.

Browser checks used a dedicated local server and isolated Chromium contexts: live discovery, first send with full snapshot, AI replies, reload recovery, scenario changes in the same conversation, explicit end, touch and keyboard controls, reduced motion, and operation with `/_shared/` unavailable. Intercepted responses separately exercised no coverage, network failure, manual retry, ambiguous session creation, draft recovery, and no automatic resend. Human handoff and email follow-up remain supported by the copied client but require configured responders to exercise live.

Public domain under the [Unlicense](https://unlicense.org/). Stand Chat's marks remain theirs.
