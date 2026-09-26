# Signalburrow: experiment verdict

A fictional product analytics site with a local experiment decision room and a real inline Stand Chat conversation. Plain HTML, CSS, and JavaScript; no consumer install or build step.

## Run and copy

From the repository, run `npm start` and open `/experiment-verdict/`. Or copy this whole folder and serve it with any static HTTP server. The two `/_shared/` references and `<sx-example-bar>` are optional gallery chrome.

Use `demo` to talk to Stand's shared demo responder. To use your own responders, replace the Stand installation script and the `<stand-inline site="demo">` Site ID with your site's configuration. The demo is not staffed by the invented business.

`stand-inline.js` and `stand-visitor.js` are standalone copies of this repository's public-domain Stand Inline implementation. No imports reference sibling folders. They implement the [custom UI contract](https://stand.chat/guide/custom-chat-ui), including recovery, ambiguous starts, idempotent message retries, AI/human identity, safe Markdown and link cards, handoff cards, returned notices/attribution, and follow-up offers. The only UI string override is in `app.js`.

## Interaction and data

- Choose ship, stop, or investigate and a working assumption. Each is a position to discuss, not a graded answer.
- Reveal aggregate metrics, device segments, a six-event synthetic replay, and sample-size caveats in sequence. Opened evidence remains available for revisiting.
- Local selections do not send messages. They prepare a visible, removable quote containing the decision, assumption, and all opened evidence. The visitor chooses when to send their reasoning or question.
- The first send uses `initialMessage` and `prompt` on session creation. Subsequent evidence updates are quoted in the visitor's next text message. A context snapshot is at most 600 characters, the inline component's quote limit.
- Session prompt context is public page data, not a secret or authorization rule. Replies cannot execute page actions or change the sample.
- “Now, about your product” explicitly excludes the sample metrics from the new topic, within the same conversation.
- The client stores session credentials and a recent transcript in sessionStorage. Local evidence and decisions use a separate key. Storage denial falls back to memory. Reset evidence retains the chat and unsent draft; End chat ends the server conversation.

The invented sample has 5,000 visitors per arm, with the same 3,000 desktop / 2,000 mobile mix. Original versus variant: 1,000 / 1,200 signups and 600 / 576 activated visitors. A first dashboard within 24 hours defines activation; every observation is mature. Signup rates are 20% / 24%, activation among signups is 60% / 48%, and activated visitors as a share of all visitors are 12% / 11.52%.

The approximate interval uses `1.96 * sqrt(pA*(1-pA)/nA + pB*(1-pB)/nB)` around the visitor-level difference. It is unadjusted for repeated looks and multiple comparisons, and is not a stopping rule. The illustrative target is 10,000 visitors per arm and a planning horizon of 14 days. Neither the event trail nor conditional activation rates establish a cause.

## Verification

From the repository root:

```sh
node --test experiment-verdict/scenario.test.mjs
npm run build
npm run og -- experiment-verdict
```

Focused tests reconcile device and aggregate counts, metric denominators, the visitor-level uncertainty interval, the ordered replay, and every context snapshot's content and length.

Browser checks completed with an isolated Chrome context and local port 4178:

- Desktop at 1440 × 1000; mobile at 390 × 844 and 320 × 740, including screenshot inspection and no horizontal page overflow.
- Keyboard radio navigation, ordered evidence reveals, touch selection, replay play/pause/scrub/reset, and reduced-motion presentation.
- Real Stand demo send with the selected decision and all evidence in the canonical visitor message; actual AI reply; same transcript recovered after reload; explicit end confirmed.
- Own-product context excludes sample counts; local reset preserves the unsent draft and live transcript.
- Controlled unavailable discovery recovers after retry. An aborted create becomes uncertain, preserves the draft on reload, and never automatically creates another session.
- Core flow works with `/_shared/` requests blocked. Final clean mobile pass had no page exceptions or console errors.

The controlled error checks used browser-only network fixtures; no fixture or scripted conversation is shipped. A human handoff and email follow-up were not available during the live demo test; their existing client behavior is retained. An initial browser run had a transient local icon connection reset; it did not recur in the clean pass. No pre-existing build failures were encountered.

`og.png` is a 1200 × 630 capture of the actual page using the repository capture script. All local visual assets are original SVG/CSS.
