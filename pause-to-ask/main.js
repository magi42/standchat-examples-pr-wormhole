// Marquee's homepage: the tour player, the questions around it, and the site.
import { getClient } from './stand-visitor.js';
import { createPlayer } from './player.js';
import { mountQuestions, readUi } from './questions.js';
import { mountSite } from './site.js';
import { DURATION, POSTER } from './tour-script.js';

const saved = readUi();
const theater = document.querySelector('[data-theater]');
const start = Number.isFinite(saved.time) && saved.time >= 0 && saved.time <= DURATION ? saved.time : POSTER;
const player = createPlayer(theater.querySelector('[data-player]'), { start });
if (saved.touched) {
  // Back after a reload: the same frame, paused, instead of autoplay.
  player.markTouched();
  player.pause({ user: true });
}
// Stand Chat's shared demo site: its demo Stand-in answers on any domain.
// Your own site uses its Site ID from Sites in Stand.
const client = getClient({ site: 'demo' });
mountQuestions({ player, root: theater, client });
mountSite({ player });
