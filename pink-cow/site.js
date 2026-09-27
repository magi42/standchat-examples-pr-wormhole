// The Remark's side of the demo: the cow with a short wait and no cookie, so it
// comes every time, plus the controls in "Try it". Not part of the cow.

import { PinkCow } from './pink-cow.js';

const cow = new PinkCow({
  siteId: 'demo', // Your own Site ID from Sites in Stand puts your team and Stand-ins behind the cow.
  hero: '#hero',
  delay: 15_000,
  once: false, // On a real site, leave this out: the cow comes once per visitor.
});

const status = document.getElementById('cow-status');
const hint = document.getElementById('hero-hint');
const waitWords = document.getElementById('wait-words');
const controls = document.getElementById('controls');
const summon = document.getElementById('summon');

const seconds = (ms) => `${Math.round(ms / 1000)} second${Math.round(ms / 1000) === 1 ? '' : 's'}`;

function describeWait() {
  waitWords.textContent = seconds(cow.options.delay);
  if (cow.status === 'armed' || cow.status === 'idle') hint.textContent = `Keep reading. In ${seconds(cow.options.delay)}, something pink walks by.`;
}

function show(text, state) {
  if (status.textContent !== text) status.textContent = text;
  status.dataset.state = state;
}

let lastLeft = null;

// The countdown, once a second.
function tick() {
  switch (cow.status) {
    case 'armed': {
      const due = cow.dueIn;
      if (due === null) show('The cow is waiting for you to scroll past the top of the letter.', 'waiting');
      else if (due > 0) show(`The cow is due in ${Math.ceil(due / 1000)} s.`, 'due');
      else show('Any moment now.', 'due');
      break;
    }
    case 'loading':
    case 'walking':
      show('The cow is on the page. Look down.', 'here');
      break;
    case 'opening':
    case 'chatting':
    case 'closing':
      show('You are chatting with the cow.', 'chat');
      break;
    case 'leaving':
      show('There it goes.', 'here');
      break;
    default:
      break;
  }
}

controls.addEventListener('change', (event) => {
  if (event.target.name !== 'wait') return;
  cow.setDelay(Number(event.target.value));
  describeWait();
  tick();
});
controls.addEventListener('submit', (event) => event.preventDefault());
summon.addEventListener('click', () => {
  cow.summon();
  tick();
});

cow.addEventListener('shown', () => {
  hint.textContent = 'There it is. Say hello.';
  summon.disabled = true;
});
cow.addEventListener('left', () => {
  lastLeft = Date.now();
  summon.disabled = false;
  hint.textContent = 'Gone. It will be back.';
  show(`Gone. The cow comes back in ${seconds(cow.options.delay)}, or when you summon it.`, 'waiting');
  // Give the farewell a moment before the countdown takes over.
  setTimeout(() => {
    if (lastLeft && Date.now() - lastLeft >= 3900) tick();
  }, 4000);
});
cow.addEventListener('armed', () => {
  if (!lastLeft) tick();
});
cow.addEventListener('skipped', ({ detail }) => {
  summon.disabled = detail.reason === 'no-webgl';
  show(detail.reason === 'no-webgl'
    ? 'This browser has no WebGL, so the cow stays in the barn.'
    : 'The cow is staying away: you already have a chat going.', 'waiting');
});
cow.addEventListener('chat-started', ({ detail }) => {
  console.log('Pink cow: chat started', detail);
});

describeWait();
cow.start();
setInterval(() => {
  if (!lastLeft || Date.now() - lastLeft >= 4000) tick();
}, 1000);
