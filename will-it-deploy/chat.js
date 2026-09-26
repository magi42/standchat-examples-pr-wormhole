// The deployment conversation's model: the prompt that tells whoever answers
// about the visitor's stack, the message format that threads one Stand
// conversation by finding and log line, and safe reply formatting with page
// references. No DOM and no network: stand-visitor.js talks to Stand, and
// app.js draws what these functions return.

import { isConversation, parseCard } from './stand-visitor.js';
import { PHASES, seconds } from './deploy.js';

export const PROMPT_LIMIT = 2000;

const ROLE = `You answer visitors on the website of Airstrip, a fictional frontend cloud (a demo on examples.stand.chat). Speak as Airstrip's team; reply in 1-3 sentences unless asked for detail.
If a fact isn't below, say you're not sure and offer to bring in someone from the team. Don't invent prices, limits or features.
Never name other companies or products, even when asked; describe them generically, like "a hosted database". The visitor's packages are fine to name.`;

// The same numbers as the page's copy and the rules in analyze.js.
const FACTS = `Facts: Node 22 and 24 (default 24); older can't build. npm, pnpm, yarn or bun, per packageManager. Static files: 18 edge regions. Node functions: 200 MB bundle, read-only disk except /tmp, 5 MB bodies; Hobby 1 GB, 10 s max; Pro 3 GB, 300 s. Edge functions: Web APIs only, no native modules, 2 MB. No long-lived WebSockets in functions: use a hosted realtime service. Cron: 2 jobs Hobby, 40 Pro. A preview URL per push; one-click rollback. Env vars per environment; .env isn't deployed. Monorepos: a project per app, with its root directory. Hobby: free, personal, 80 GB, 400 build min/mo. Pro: $18/member/mo, 1 TB, 5,000 min. Enterprise: custom, SSO, 99.99% SLA.`;

const conventions = (example) => `The page simulates deploying the visitor's package.json. Each message starts with its subject: [Finding: id], [Log: phase "line"] or [Stack]; answer about it, without repeating it. [New stack: ...] first means they loaded another package.json. When a finding, phase or plan helps, point to it: write its exact name in double square brackets, like [[${example}]] or [[Building]]; one or two per reply. Phases: ${PHASES.join(', ')}. Plans: Hobby, Pro, Enterprise.`;

const SYMBOL = { error: '✕', warn: '⚠', info: 'ℹ', ok: '✓' };

/** The private context for a new conversation: who we are, the facts, and this stack. */
export function buildPrompt(a, d) {
  const example = a.findings.find((f) => f.level === 'warn' || f.level === 'error')?.id ?? a.findings[0]?.id ?? 'node-version';
  const fixed = `${ROLE}\n\n${FACTS}\n\n${conventions(example)}\n\n`;
  return fixed + stackSummary(a, d, PROMPT_LIMIT - fixed.length);
}

/**
 * "Stack, tidepool-store: SvelteKit 2.15 (…); … Findings: … Packages: …",
 * within budget. It fills greedily, most important first: every warning and
 * error by id, then their reasons (errors first), the tips, up to 25 package
 * names, and last what works as is.
 */
export function stackSummary(a, d, budget = 700) {
  const head = `Stack, ${a.name}: ${frameworkText(a)}; ${nodeText(a)}; ${a.pm.label}; ${a.deps.length} deps + ${a.devDeps.length} dev; ${outcomeText(d)}.`;
  const important = a.findings.filter((f) => f.level === 'error' || f.level === 'warn');
  const flagged = new Set(a.findings.flatMap((f) => f.packages ?? []));
  const names = [...new Set([...[...a.deps, ...a.devDeps].filter((n) => flagged.has(n)), a.framework?.pkg, ...a.deps, ...a.devDeps].filter(Boolean))];

  const findings = important.map((f) => `${SYMBOL[f.level]} ${f.id}`);
  const packages = [];
  const render = () => {
    const more = names.length - packages.length;
    return `${head} Findings: ${findings.join('; ')}.${packages.length ? ` Packages: ${packages.join(', ')}${more ? `, +${more} more` : ''}.` : ''}`;
  };
  // Try a change; keep it only if the summary still fits.
  const attempt = (apply, undo) => {
    apply();
    if (render().length <= budget) return true;
    undo();
    return false;
  };
  const byLevel = [...important].sort((x, y) => (x.level === 'error' ? 0 : 1) - (y.level === 'error' ? 0 : 1));
  for (const f of byLevel) {
    const i = important.indexOf(f);
    const short = findings[i];
    attempt(() => (findings[i] = `${short}: ${f.brief || f.title}`), () => (findings[i] = short));
  }
  for (const f of a.findings.filter((x) => x.level === 'info')) {
    if (!attempt(() => findings.push(`${SYMBOL.info} ${f.id}`), () => findings.pop())) break;
  }
  for (const name of names.slice(0, 25)) {
    if (!attempt(() => packages.push(name), () => packages.pop())) break;
  }
  for (const f of a.findings.filter((x) => x.level === 'ok')) {
    if (!attempt(() => findings.push(`${SYMBOL.ok} ${f.id}`), () => findings.pop())) break;
  }
  return render().slice(0, budget);
}

/** One line for a stack that arrives mid-conversation, as [New stack: …]. */
export function stackLine(a, d) {
  const flagged = a.findings.filter((f) => f.level !== 'ok').map((f) => `${SYMBOL[f.level]} ${f.id}`);
  const line = `${a.name}: ${frameworkText(a)}, Node ${a.node.major || 'none'}, ${a.pm.label}, ${a.count} deps, ${outcomeText(d)}; findings: ${flagged.join(', ') || 'none'}`;
  return clean(line, 420);
}

function frameworkText(a) {
  const out = {
    static: 'static site',
    ssr: 'SSR: Node functions + prerendered pages',
    hybrid: a.framework?.output === 'spa' ? `static app + ${a.server} as a Node function` : 'static pages, Node functions, edge middleware',
    spa: 'single-page app',
    api: 'API as a Node function',
    none: 'monorepo root, no app',
  }[a.output];
  return a.framework ? `${a.framework.label} (${out})` : `no framework (${out})`;
}

function nodeText(a) {
  const n = a.node;
  if (n.status === 'unsupported') return `engines.node "${n.range}" allows no supported Node`;
  if (n.status === 'missing') return `Node ${n.major} (no engines.node)`;
  if (n.status === 'unknown') return `Node ${n.major} (engines.node "${n.range}" unreadable)`;
  return `Node ${n.major} (engines.node "${n.range}")`;
}

function outcomeText(d) {
  return d.outcome === 'ready' ? `simulated deploy ready in ${seconds(d.durationMs)}` : `simulated deploy failed at ${d.failedPhase}`;
}

// --- Threads: one conversation, a subject per message ------------------------

export const STACK = Object.freeze({ kind: 'stack' });

/** "[Finding: bcrypt]", "[Log: Installing "…"]", "[Stack]": what the team sees first. */
export function subjectPrefix(anchor) {
  if (anchor.kind === 'finding') return `[Finding: ${clean(anchor.id, 40)}]`;
  if (anchor.kind === 'log') return anchor.text ? `[Log: ${anchor.phase} "${clean(anchor.text, 96)}"]` : `[Log: ${anchor.phase}]`;
  return '[Stack]';
}

export function composeMessage(anchor, text, newStack = '') {
  return `${newStack ? `[New stack: ${newStack}] ` : ''}${subjectPrefix(anchor)} ${String(text).trim()}`;
}

/** Reads a visitor message back into its subject and text, after a reload too. */
export function parseMessage(body) {
  let rest = String(body ?? '');
  let newStack = '';
  const introduced = rest.match(/^\[New stack: ([^\]]*)\]\s*/);
  if (introduced) {
    newStack = introduced[1];
    rest = rest.slice(introduced[0].length);
  }
  const m = rest.match(/^\[(Finding|Log|Stack)(?::\s*([^\]]*))?\]\s*/);
  if (!m) return { anchor: STACK, text: rest, newStack };
  const text = rest.slice(m[0].length);
  if (m[1] === 'Finding' && m[2]) return { anchor: { kind: 'finding', id: m[2].trim() }, text, newStack };
  if (m[1] === 'Log' && m[2]) {
    const log = m[2].match(/^([^"]+?)\s*(?:"(.*)")?\s*$/);
    if (log) return { anchor: { kind: 'log', phase: log[1].trim(), text: log[2] ?? '' }, text, newStack };
  }
  return { anchor: STACK, text, newStack };
}

export function anchorKey(anchor) {
  if (anchor.kind === 'finding') return `finding:${anchor.id}`;
  if (anchor.kind === 'log') return `log:${anchor.phase}:${anchor.text ?? ''}`;
  return 'stack';
}

/** Log text as it appears inside a subject prefix: no brackets or straight quotes. */
export function clean(text, max = 96) {
  const t = String(text).replace(/"/g, '\'').replace(/\[/g, '(').replace(/\]/g, ')').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Does a subject's (maybe shortened) log text name this log line? */
export function sameLogText(subjectText, lineText) {
  const a = String(subjectText);
  const b = clean(lineText, 1000);
  return a.endsWith('…') ? b.startsWith(a.slice(0, -1)) : a === b;
}

/**
 * Sorts the transcript into threads. A visitor message opens or continues the
 * thread its subject names; replies belong to the latest visitor message
 * before them; system cards belong to the whole conversation.
 */
export function threadsOf(messages, pending) {
  const threads = new Map();
  const byMessage = new Map();
  const touch = (anchor) => {
    const key = anchorKey(anchor);
    if (!threads.has(key)) threads.set(key, { key, anchor, count: 0, lastSeq: 0 });
    return threads.get(key);
  };
  let current = null;
  for (const m of messages) {
    if (hidden(m)) continue;
    if (m.senderType === 'visitor' && m.type === 'text') {
      current = touch(parseMessage(m.body).anchor);
    } else if (!isConversation(m)) {
      continue; // System cards are for everyone.
    }
    const thread = current ?? touch(STACK);
    thread.count++;
    thread.lastSeq = m.seq;
    byMessage.set(m.messageId, thread.key);
  }
  if (pending?.body) touch(parseMessage(pending.body).anchor);
  return { threads, byMessage };
}

/** Never shown: private prompts (ours comes back as one), and bookkeeping cards. */
export function hidden(m) {
  if (m.type === 'system-prompt' || m.senderType === 'system-prompt') return true;
  if (m.type === 'system-card' || m.senderType === 'system-card') {
    return !SHOWN_CARDS.has(parseCard(m.body).cardType);
  }
  return !isConversation(m);
}

const SHOWN_CARDS = new Set(['handoff', 'human-transfer', 'standin-takeover', 'session-end', 'rep-followup-offer', 'rep-followup-confirmation']);

/** The stack the answerer knows about last, from the transcript: the prompt's, or the latest [New stack: …]. */
export function lastIntroducedStack(messages, promptStack) {
  let name = promptStack;
  for (const m of messages) {
    if (m.senderType !== 'visitor' || m.type !== 'text') continue;
    const introduced = parseMessage(m.body).newStack;
    if (introduced) name = introduced.split(':')[0].trim();
  }
  return name;
}

// --- Replies ---------------------------------------------------------------------

const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Normalizes a reference name: case, spacing and trailing punctuation don't matter. */
export function normalizeRef(name) {
  return String(name).toLowerCase().replace(/^[\s✕⚠ℹ✓•·-]+/, '').replace(/\s+/g, ' ').replace(/[.,;:!?]+$/, '').trim();
}

/**
 * Formats reply text as safe HTML: escaped first, then paragraphs, "- " lists,
 * **bold**, `code`, autolinked http(s) URLs, and [[references]] that
 * resolve(name) recognizes as buttons. Unknown references become plain text.
 */
export function formatReply(text, resolve = () => null) {
  const seen = new Set();
  const inline = (raw) => {
    const parts = String(raw).split(/(`[^`\n]+`)/g);
    return parts.map((part) => {
      if (/^`[^`\n]+`$/.test(part)) return `<code>${escape(part.slice(1, -1))}</code>`;
      let html = escape(part);
      html = html.replace(/\[\[([^[\]\n]{1,80})\]\]/g, (whole, name) => {
        const target = resolve(name.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"'));
        if (!target) return name;
        if (seen.has(target.key)) return `<strong>${escape(target.label)}</strong>`;
        seen.add(target.key);
        return `<button type="button" class="ref ref-${target.kind}${target.level ? ` is-${target.level}` : ''}" data-ref="${escape(target.key)}" title="${escape(target.title ?? '')}">${target.icon ?? ''}<span>${escape(target.label)}</span></button>`;
      });
      html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
      html = html.replace(/\bhttps?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]/g, (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
      return html;
    }).join('');
  };
  const blocks = String(text).trim().split(/\n{2,}/);
  return blocks.map((block) => {
    const lines = block.split('\n');
    if (lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l))) {
      const ordered = /^\s*\d/.test(lines[0]);
      const items = lines.map((l) => `<li>${inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''))}</li>`).join('');
      return ordered ? `<ol>${items}</ol>` : `<ul>${items}</ul>`;
    }
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('');
}

/** A short, plain version of a reply, for the live region and previews. */
export function plainReply(text) {
  return String(text).replace(/\[\[([^[\]\n]{1,80})\]\]/g, '$1').replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/`([^`\n]+)`/g, '$1');
}

/** Visitor-facing words for the client's error codes. */
export const ERRORS = {
  connect: 'Can’t reach Airstrip’s team right now.',
  start: 'That didn’t start a conversation. Your question is back in the box.',
  uncertain: 'Your first question may have started a conversation, but we couldn’t confirm it.',
  send: 'Not delivered.',
  lost: 'The conversation closed before this was delivered.',
  gone: 'This conversation isn’t available anymore.',
  paused: 'The connection dropped. Reconnect to see new replies.',
  refresh: 'Couldn’t refresh the conversation.',
  end: 'Couldn’t end the conversation. Try again.',
  email: 'Couldn’t send your email. Check it and try again.',
  offer: 'That follow-up offer has expired.',
};
