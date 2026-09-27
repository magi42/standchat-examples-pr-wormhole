import { StandClient, safeUrl } from './stand-client.js';
import { SpaceScene, Transmissions } from './scene.js';
import { Sound } from './sound.js';

const $ = selector => document.querySelector(selector);
const input = $('#message'), transcript = $('#transcript');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const scene = new SpaceScene($('#space'));
const flights = new Transmissions($('#letters'), scene, text => { $('#flight-status').textContent = text; });
const sound = new Sound(updateSound);
function updateSound() {
  for (const button of document.querySelectorAll('[data-sound]')) {
    button.disabled = !sound.available;
    button.setAttribute('aria-pressed', String(sound.enabled));
    button.setAttribute('aria-label', !sound.available ? 'Sound unavailable' : sound.waiting ? 'Start sound' : sound.enabled ? 'Mute sound' : 'Enable sound');
    button.innerHTML = `♫ <span>${!sound.available ? 'Sound unavailable' : sound.waiting ? 'Start sound' : sound.enabled ? 'Sound on' : 'Sound off'}</span>`;
  }
  $('#sound-hint').hidden = !sound.waiting;
}
for (const button of document.querySelectorAll('[data-sound]')) button.addEventListener('click', () => sound.toggle());
function unlockSound(event) {
  if (event.target.closest?.('[data-sound]')) return;
  if (event.type === 'keydown' && (event.repeat || ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key))) return;
  // Retry only while blocked, so typing cannot restart the music's fade.
  if (sound.waiting) sound.unlock();
}
addEventListener('pointerdown', unlockSound, { capture: true });
// Touch browsers grant activation on release rather than pointerdown.
addEventListener('pointerup', unlockSound, { capture: true });
addEventListener('keydown', unlockSound, { capture: true });
updateSound();
let storage;
try { storage = sessionStorage; } catch { /* In-memory chat still works when storage is blocked. */ }
const greeting = 'Asterion, this is Horizon. Your signal is reaching us from the other side of spacetime. What would you like to know?';
const client = new StandClient({
  siteId: 'demo', storage, analyticsId: 'wormhole-bridge', greeting,
  prompt: 'This is Wormhole, a fictional cinematic spacecraft chat demo. You are Horizon, a friendly AI communications officer on the other side of a wormhole, talking to a visitor aboard the fictional exploration vessel Asterion. Reply in the visitor\'s language; default English. Use a light, atmospheric science-fiction voice, without claiming real space travel or real telemetry. Be candid that you are an AI in a Stand Chat demo if asked. Help with the demo, space, science, coding, or ordinary questions. Keep most replies to 2-4 short sentences (ideally under 450 characters) so they work as visual transmissions. The wormhole is a procedural WebGL gravitational lens; letters fly on Canvas and the opening is an SVG/CSS camera move. Never claim any affiliation with Star Trek or Interstellar. This is not an emergency or spacecraft control system.',
});
const rendered = new Map();
const seen = new Set();
let restoring = true, introTimer, introStageTimer, outgoing = '', generation = 0;
let flightQueue = Promise.resolve();
let bridgeReady = false, activated = false, paused = reduced.matches;

function setMotion(value) {
  paused = value; scene.paused = value; flights.paused = value;
  document.body.classList.toggle('motion-paused', value);
  $('#motion').setAttribute('aria-pressed', String(value));
  $('#motion').title = value ? 'Resume animation' : 'Pause animation';
  $('#motion').setAttribute('aria-label', $('#motion').title);
  $('#motion').innerHTML = `${value ? '▷' : 'Ⅱ'} <span>Motion</span>`;
  if (value) flights.finish();
  scene.draw(0);
}
$('#motion').addEventListener('click', () => setMotion(!paused));
reduced.addEventListener('change', e => { setMotion(e.matches); if (e.matches) endIntro(false); });
setMotion(paused);

function endIntro(focus = true, immediately = false) {
  clearTimeout(introTimer); clearTimeout(introStageTimer);
  sound.enterBridge();
  $('#intro').classList.add('leaving'); $('#intro').inert = true;
  document.body.classList.remove('arriving'); $('#bridge').inert = false; bridgeReady = true;
  scene.resize();
  if (immediately) $('#intro').hidden = true;
  else setTimeout(() => { if (bridgeReady) $('#intro').hidden = true; }, 1000);
  if (client.state.greeting) client.showGreeting(client.state.greeting);
  if (focus) input.focus({ preventScroll: true });
}
function startIntro() {
  if (paused) { endIntro(false); return; }
  sound.startIntro();
  flights.finish(); bridgeReady = false; $('#bridge').inert = true;
  document.body.classList.add('arriving');
  const intro = $('#intro'); intro.hidden = false; intro.inert = false; intro.classList.remove('leaving');
  // Restart CSS timeline without reloading or disturbing the conversation.
  intro.querySelectorAll('.ship,.intro-copy,.intro-progress i,.intro-stars').forEach(el => { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; });
  $('#intro-stage').textContent = 'APPROACHING VESSEL';
  clearTimeout(introTimer); clearTimeout(introStageTimer);
  introStageTimer = setTimeout(() => { $('#intro-stage').textContent = 'ENTERING THE BRIDGE'; }, 7200);
  introTimer = setTimeout(() => endIntro(false), 10000);
  $('#skip').focus({ preventScroll: true });
}
$('#skip').addEventListener('click', () => endIntro());
$('#replay').addEventListener('click', startIntro);
// The shared example bar links directly to the explanation, even during the intro.
addEventListener('hashchange', () => { if (location.hash === '#how-it-works') endIntro(false, true); });
addEventListener('keydown', e => { if (e.key === 'Escape' && !bridgeReady) endIntro(); });

function bodyText(element, body, key) {
  if (element.dataset.raw === body) return;
  element.dataset.raw = body; element.replaceChildren();
  for (const part of body.split(/(https?:\/\/[^\s<>]+)/g)) {
    const url = /^https?:\/\//.test(part) && safeUrl(part);
    if (!url) { element.append(document.createTextNode(part)); continue; }
    const a = document.createElement('a'); a.href = url; a.textContent = part; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.addEventListener('click', () => client.trackLinkClick(key, url)); element.append(a);
  }
}
function nearBottom() { return transcript.scrollHeight-transcript.scrollTop-transcript.clientHeight < 70; }
function addMessage(key, body, kind, sender, animate = false) {
  let row = rendered.get(key);
  if (!row) {
    row = document.createElement('div'); row.className = `message ${kind}`;
    const label = document.createElement('span'); label.className = 'sender';
    const content = document.createElement('span'); content.className = 'body';
    row.append(label, content); rendered.set(key,row); transcript.append(row);
  }
  row.querySelector('.sender').textContent = sender;
  if (animate && !seen.has(key)) {
    row.classList.add('receiving'); row.querySelector('.body').textContent = 'Incoming transmission…';
    const epoch = generation;
    flightQueue = flightQueue.then(async () => {
      if (epoch !== generation) return;
      if (bridgeReady) { sound.ping(true); await flights.fly(body, true); }
      if (epoch !== generation || !row.isConnected) return;
      const follow = nearBottom(); row.classList.remove('receiving'); bodyText(row.querySelector('.body'),body,key);
      if (follow) transcript.scrollTop = transcript.scrollHeight;
    });
  } else if (!row.classList.contains('receiving')) bodyText(row.querySelector('.body'),body,key);
  seen.add(key); return row;
}
function systemText(message) {
  if (message.type !== 'system-card' && message.senderType !== 'system-card') return message.body;
  try {
    const card = JSON.parse(message.body);
    return ({ handoff: `${card.repName || 'A team member'} joined the conversation.`, 'human-transfer': `${card.repName || 'A team member'} joined the conversation.`, 'standin-takeover': `${card.standinName || 'AI Stand-in'} is here to help.`, 'session-end': 'The conversation has ended.', 'rep-followup-offer': 'Leave an email for a follow-up.', 'rep-followup-confirmation': 'Your follow-up request was sent.' })[card.cardType] || '';
  } catch { return ''; }
}

client.subscribe(state => {
  const follow = nearBottom();
  const ready = ['available','active'].includes(state.phase);
  const host = state.host.name || 'Horizon';
  $('#host').textContent = state.phase === 'loading' ? 'Finding a responder…' : `${host} ${state.host.kind === 'standin' ? '· AI Stand-in' : state.host.kind === 'rep' ? '· Team' : ''}`;
  $('#connection').textContent = ({loading:'FINDING SIGNAL',available:'CHANNEL OPEN',active:state.connection === 'online'?'CONNECTED':'RECONNECTING',unavailable:'OFFLINE',uncertain:'UNCONFIRMED',ended:'ENDED'})[state.phase];
  const keys = new Set();
  if (state.greeting && !state.messages.some(m=>m.body===state.greeting)) {
    keys.add('greeting'); addMessage('greeting',state.greeting,'host','HORIZON');
    if (bridgeReady) client.showGreeting(state.greeting);
  }
  for (const message of state.messages) {
    if (message.type === 'system-prompt' || message.senderType === 'system-prompt') continue;
    const system = message.type === 'system-card' || ['system','system-card'].includes(message.senderType);
    const body = system ? systemText(message) : message.body; if (!body) continue;
    const visitor = message.senderType === 'visitor';
    keys.add(message.messageId);
    addMessage(message.messageId,body,system?'system':visitor?'visitor':'host',system?'CHANNEL':visitor?'YOU / ASTERION':host.toUpperCase(),!restoring && !system && !visitor && body !== state.greeting);
  }
  if (outgoing && state.messages.some(m=>m.senderType==='visitor' && m.body===outgoing)) outgoing = '';
  if (state.pending) { keys.add('pending'); addMessage('pending',state.pending.body,'visitor','YOU / PENDING'); }
  else if (outgoing) { keys.add('outgoing'); addMessage('outgoing',outgoing,'visitor','YOU / SENDING'); }
  for (const [key,row] of rendered) if (!keys.has(key)) { row.remove(); rendered.delete(key); }
  if (keys.size) $('.empty-state')?.remove();
  [...keys].forEach((key,index) => { const row=rendered.get(key); if(transcript.children[index]!==row) transcript.insertBefore(row,transcript.children[index]||null); });
  if (follow) transcript.scrollTop=transcript.scrollHeight;
  $('#typing').textContent = state.typing || state.preview?.text ? '··· A reply is forming on the other side' : '';
  if(input.value!==state.draft) input.value=state.draft;
  input.disabled=state.busy; $('#send').disabled=!ready || state.busy || (!state.draft.trim() && !state.pending);
  const problem = state.error || (state.phase==='unavailable'?'The channel is unavailable. Your draft is saved. Try reconnecting in a moment.':state.phase==='ended'?'This conversation has ended. You can open a new channel.':'');
  $('#recovery').hidden=!problem; $('#error').textContent=problem;
  $('#retry').textContent=state.phase==='uncertain'?'Start a new chat (previous start unconfirmed)':state.phase==='ended'?'Open a new channel':state.pending?'Retry message':'Reconnect';
  $('#retry').disabled=state.busy; $('#notice').textContent=state.notice;
  $('#attribution').href=safeUrl(state.poweredByUrl)||'https://stand.chat/';
  $('#end').hidden=state.phase!=='active'; $('#end').disabled=state.busy;
  $('#followup').hidden=!state.followupOffered; $('#followup button').disabled=state.busy;
});

input.addEventListener('input',()=>{client.setDraft(input.value);input.style.height='auto';input.style.height=`${Math.min(90,input.scrollHeight)}px`;});
async function send() {
  const state=client.state;
  if(state.busy || !['available','active'].includes(state.phase))return;
  const body=state.pending?.body || state.draft.trim(); if(!body)return;
  if(!activated){client.activate('keyboard');activated=true;}
  outgoing=body;
  sound.ping(false);
  const outbound=flights.fly(body);
  flightQueue=Promise.all([flightQueue,outbound]);
  await client.send();
  outgoing=''; rendered.get('outgoing')?.remove();rendered.delete('outgoing');
  input.style.height='auto';input.focus({preventScroll:true});
}
$('#compose').addEventListener('submit',e=>{e.preventDefault();void send();});
input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();void send();}});
$('#retry').addEventListener('click',()=>{
  if(['ended','uncertain'].includes(client.state.phase)) { generation++;flights.finish();flightQueue=Promise.resolve();seen.clear();activated=false;void client.newChat(); }
  else if(client.state.pending)void send(); else void client.retry();
});
$('#end').addEventListener('click',()=>client.end());
$('#followup').addEventListener('submit',e=>{e.preventDefault();void client.submitEmail($('#email').value.trim());});
$('#attribution').addEventListener('click',()=>client.badgeClick());
// Restore the saved transcript synchronously, then animate only newly received messages.
client.mount(); restoring=false;
if(reduced.matches || location.hash === '#how-it-works' || new URLSearchParams(location.search).has('skipintro'))endIntro(false, true);else startIntro();

let previous=0, lastDraw=0;
function frame(now) {
  const dt=Math.max(0,(now-previous)/1000);previous=now;
  if(!document.hidden && bridgeReady){
    if(!paused && now-lastDraw>32){scene.draw((now-lastDraw)/1000);lastDraw=now;}
    else if(paused)lastDraw=now;
    flights.draw(dt);
  } else lastDraw=now;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
document.addEventListener('visibilitychange', () => {
  sound.setHidden(document.hidden);
  if (document.hidden) flights.finish();
  else { previous = performance.now(); lastDraw = previous; }
});
