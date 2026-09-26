// The private context sent with the first question (at most 2,000 characters).
// The Stand-in reads it, and so does the team in Stand. The tour's outline is
// generated from the script, so the times it cites are the times on screen.

import { CHAPTERS, DURATION, MOMENTS, formatTime } from './tour-script.js';
import { describeMoment } from './threads.js';

const ROLE = `You are answering visitors on the website of Marquee, a fictional website builder (a demo page on examples.stand.chat; Marquee is invented). Speak as Marquee's team. Keep replies short: 1-3 sentences unless asked for detail.
If a fact isn't below, say you're not sure and offer to bring in someone from the team. Don't invent prices, limits or features.`;

// Keep these in step with the pricing and FAQ sections of index.html.
const FACTS = `Prices per site per month. Free $0: marquee.site address, 1 GB bandwidth, 100 CMS items, 1 language. Basic $12: custom domain, 20 GB, 1,000 CMS items, 2 languages. Pro $29: 100 GB, 10,000 CMS items, 5 languages, staging, password pages. Scale $99: 500 GB, 50,000 CMS items, 15 languages, SSO, 99.99% SLA. 2 editors included, more $15/month each. Built in: SSL, CDN hosting, sitemaps, meta tags, redirects, cookie-free analytics. Imports other builders' sites by URL. React code components. Effects respect reduced-motion settings. Selling products: via integrations only.`;

const PAGE = `This page: a 1:50 tour of the editor building a site for Loam, a made-up ceramics studio. Visitors pause it to ask. Every visitor message starts with ⏱, the time and chapter they paused at, then a colon, like "⏱ 0:42 Breakpoints: ...". Answer about what's on screen then. Don't repeat the marker.`;

const REFERENCES = `When a moment helps answer, point to it: its time in double square brackets, like [[1:12]], or a chapter, like [[Chapter: CMS]]. At most one or two per reply.`;

/** "Tour: Templates 0:00 picking a template, 0:06 template opens | Canvas 0:13 …" */
export function tourOutline() {
  const chapters = CHAPTERS.map((chapter, i) => {
    const end = CHAPTERS[i + 1]?.start ?? DURATION;
    const moments = MOMENTS.filter((m) => m.t >= chapter.start && m.t < end).map((m) => `${formatTime(m.t)} ${m.label}`);
    return `${chapter.name} ${moments.join(', ')}`;
  });
  return `Tour: ${chapters.join(' | ')}.`;
}

/** The prompt for a conversation whose first question is about `time`. */
export function buildPrompt(time) {
  const moment = describeMoment(time);
  const context = `The visitor first paused at ${moment.stamp} (${moment.chapter}: ${moment.label}).`;
  return [ROLE, '', FACTS, '', PAGE, tourOutline(), REFERENCES, '', context].join('\n').slice(0, 2000);
}
