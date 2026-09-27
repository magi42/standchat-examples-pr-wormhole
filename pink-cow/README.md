# Pink cow

A low-poly pink cow with a question mark on its side walks across the page when
a visitor lingers. Click it, and a chat unfolds out of the cow: a complete
custom chat UI on [Stand's Visitor API](https://stand.chat/guide/custom-chat-ui).
A nod to Seth Godin's *Purple Cow*: nobody remarks on a brown one.

Live: <https://examples.stand.chat/pink-cow/>. The page is The Remark, a
made-up newsletter about attention; the cow is the reusable part.

## Use it on your page

```sh
npx degit standchat/examples/pink-cow pink-cow
```

```html
<script type="importmap">
  { "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.min.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/"
  } }
</script>
<script type="module">
  import { PinkCow } from './pink-cow/pink-cow.js';

  const cow = new PinkCow({ siteId: 'your-site-id', hero: '#hero' });
  cow.start();
</script>
```

The page carries only `pink-cow.js`, the chat card and the Stand client. three.js
and the cow load when the cow is about to walk on. `pink-cow.css` is linked
automatically; edit it to restyle the chat card.

`siteId: 'demo'` is Stand Chat's shared demo site, which answers on any domain
(including localhost) with Stand Chat's demo Stand-in. Your own Site ID, from
**Sites** in Stand, puts your team and your Stand-ins behind the cow.

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `siteId` | `'demo'` | Your Site ID from Sites in Stand. |
| `hero` | `null` | Element or selector. The wait starts once its bottom is in the top quarter of the viewport. `null`: the wait starts at `start()`. |
| `delay` | `30_000` | Milliseconds of visible time before the cow walks on. A hidden tab does not count. |
| `once` | `true` | Come once per visitor: a cookie remembers the visit. `false`: after each visit the wait starts over. |
| `cookie` | `'pink_cow'` | The cookie's name. It holds only `seen` or `engaged`, no identifier. |
| `cookieDays` | `400` | How long the cookie lasts. |
| `hasChatted` | checks the Stand widget's saved conversation | `() => boolean`. A visitor who already chats never sees the cow; if they start mid-walk, it walks on. |
| `covered` | modals, `<dialog open>`, the Stand widget's open panel | `() => boolean`. While true the cow waits; it never walks behind something. |
| `title`, `subtitle` | *Inside the pink cow* | The chat card's header. |
| `greeting` | *Moo. Nobody stops scrolling…* | The first bubble. Stand records it as the conversation's opening line. |
| `prompt` | explains the cow and custom chat UIs | Context for the responder, stored with the conversation. Not a secret; Stand keeps 2,000 characters. |
| `suggestions` | three questions | Buttons under the greeting. `[]` for none. |
| `placeholder` | *Ask the cow anything…* | The composer's placeholder. |
| `links` | examples.stand.chat, the guide | `{ label, href }[]` in the card's footer. |
| `bubble` | `'Curious?'` | What the cow says when it stops to look. `''` for nothing. |
| `analyticsId` | `'pink-cow'` | Names this entry point in Stand's analytics (`activationAnalyticsId`). |
| `zIndex` | `90` | The overlay's z-index; the chat sits five above. |
| `storage` | `null` | `sessionStorage` or `localStorage` to keep a conversation across reloads. By default it ends with the cow. |
| `apiBase`, `wsBase` | Stand's production API | For staging or self-hosted setups. |

## Methods and events

```js
cow.start();               // arm the trigger; skips visitors who saw the cow or already chat
cow.summon();              // bring the cow out now, wait or no wait
cow.setDelay(5_000);       // change the wait, including a running countdown
cow.dismiss();             // close the chat, or send a walking cow on its way
cow.destroy();             // remove everything
cow.status;                // idle | armed | loading | walking | opening | chatting | closing | leaving | done
cow.dueIn;                 // ms until the cow is due, or null while the wait has not started
```

`PinkCow` is an `EventTarget`. Events, with `event.detail`: `armed`, `shown`
(`{ summoned, reducedMotion }`), `opened`, `chat-started` (`{ suggestion }`, once
Stand has created the conversation), `link-clicked` (`{ url }`), `closed`
(`{ chatStarted }`), `left`, `skipped` (`{ reason: 'seen' | 'chatted' | 'no-webgl' }`).

## Files

- `pink-cow.js`: the component. Options, the wait, the cookie, the clickable
  cow, the speech bubble, and the choreography from click to gallop.
- `cow-chat.js`, `pink-cow.css`: the chat card. An accessible dialog with the
  transcript, streamed replies, suggestions, the follow-up form and attribution.
- `stand-client.js`: the Stand part, from the vintage terminal example.
  Discovery, one-time creation, idempotent sends, WebSocket receive, recovery.
- `cow-model.js`, `cow-motion.js`, `cow-stage.js`, `cow-glyph.js`: the
  procedural cow, its gait (planted hooves, inverse kinematics), and the stage
  with the folding paper card.
- `index.html`, `style.css`, `site.js`: The Remark, the demo page. Not needed
  on your site.

## Behaviour worth knowing

- With `prefers-reduced-motion`, a still cow fades in, waits 14 seconds and
  fades out; the chat opens without the unfolding.
- Without WebGL there is no cow. `start()` dispatches `skipped`.
- Closing the chat ends the conversation on Stand's side, since the cow leaves.
- While the chat is open the standard Stand widget, if the page has one, is
  hidden so the two do not compete.
- The cow only draws what it needs: it idles at 30 fps while the chat is open
  and releases its GPU context when it leaves.

Public domain, like the rest of this repository. Stand Chat's name and logo
are not.
