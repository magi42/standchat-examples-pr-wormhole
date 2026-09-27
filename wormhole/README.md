# Wormhole / Asterion

An original, cinematic Stand Chat example in English. A ten-second exterior approach cuts to a starship bridge. Messages travel as individual glyphs into a gravitationally lensed wormhole; incoming replies emerge and settle into a readable communications console.

Run the repository with `npm start`, then open **http://localhost:3000/wormhole/**. Any static HTTP server also works. `?skipintro` opens the bridge directly (useful for screenshots). No install, framework, build step, model downloads, or API keys are required.

## Files

- `index.html`, `style.css`: semantic chat console, responsive bridge, crew silhouettes, accessible controls, and cinematic intro.
- `ship.svg`: original vector spacecraft. The intro is a real-time CSS/SVG camera sequence, not a prerecorded video.
- `scene.js`: procedural WebGL starfield and spherical lens, Canvas 2D glyph trajectories, opt-in synthesized audio. A CSS lens remains visible if WebGL is unavailable.
- `app.js`: presentation and message sequencing. Incoming messages wait for outgoing flights, then arrive before their final text is shown. Full messages remain selectable in the DOM; long flights use a 160-character visual excerpt.
- `stand-client.js`: local copy of the repository's Stand Visitor API client, with a separate `stand-wormhole` session-storage namespace. Handles discovery, authenticated HTTP sends, WebSocket replies, retry IDs, reconnect, transcript restoration, handoffs, and follow-up email offers.

The shared `demo` Site ID supplies a real Stand conversation. Network errors are displayed with retry controls; no fake AI replies are substituted. Replace `siteId: 'demo'` in `app.js` and the widget's `data-stand-id` in `index.html` to use your own Stand site. The standard widget is initially hidden: the bridge renders the chat through the Visitor API. The persona is fictional and the responder is identified as AI or human. Telemetry is decorative fiction.

The intro can be skipped or replayed. The motion control stops effects and settles pending messages immediately. `prefers-reduced-motion` skips the intro and glyph motion automatically. Audio is off by default, opt-in, and suspended when the page is hidden. Enter sends, Shift+Enter adds a line, and IME composition is respected. Session restoration does not replay old messages. Remote text is rendered as text nodes; only HTTP(S) links become clickable.

The example is self-contained and can be copied as a folder. Fonts have system fallbacks. All scene graphics are original code/vector artwork; no movie or franchise assets are included.

## Repository conventions

The page uses the shared `sx-example-bar` and the standard `#how-it-works` explanation, including usage instructions, code, and a copy command. All interface text, accessibility labels, metadata, and the responder's default language are English. Existing conversations retain their original messages; start a new chat to use the updated persona.

Run `npm run build` to validate the gallery metadata. Capture the 1200×630 social image with `npm run og -- wormhole` (Node 22+ and Chrome, as required by the repository's capture script). The bridge is the `data-og-focus` target, and the intro uses `data-og-hide`, so the standard capture shows the console. All implementation and original artwork live in this folder under the repository's Unlicense; there are no installed dependencies or required build step. `/_shared/` is optional site chrome.
