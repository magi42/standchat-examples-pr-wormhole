// Icons for the tracker, drawn for this page. All static markup: nothing from
// a message or the network ever goes through these strings.

const svg = (body, { size = 16, box = 16, cls = 'tk-i' } = {}) =>
  `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 ${box} ${box}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICONS = {
  search: svg('<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/>'),
  compose: svg('<path d="M13 8.5V12a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 12V4.5A1.5 1.5 0 0 1 4.5 3H8"/><path d="m11.2 2.6 2.2 2.2-5.6 5.6H5.6V8.2z"/>'),
  inbox: svg('<path d="M2.5 9.5 4 3.8A1 1 0 0 1 5 3h6a1 1 0 0 1 1 .8l1.5 5.7v2.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z"/><path d="M2.5 9.5h3.2l.8 1.5h3l.8-1.5h3.2"/>'),
  mine: svg('<circle cx="8" cy="8" r="5.5" stroke-dasharray="2.2 2.1"/><circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none"/>'),
  triage: svg('<circle cx="8" cy="8" r="5.75"/><path d="M5.4 6.6h5.2M9.3 5.3l1.3 1.3-1.3 1.3M10.6 9.4H5.4M6.7 8.1 5.4 9.4l1.3 1.3"/>'),
  issues: svg('<rect x="2.5" y="2.5" width="11" height="11" rx="2.5"/><path d="M5.5 6h5M5.5 8.5h5M5.5 11h3"/>'),
  chevronDown: svg('<path d="m4.5 6.5 3.5 3.5 3.5-3.5"/>'),
  chevronRight: svg('<path d="m6.5 4.5 3.5 3.5-3.5 3.5"/>'),
  chevronLeft: svg('<path d="M9.5 4.5 6 8l3.5 3.5"/>'),
  chevronUp: svg('<path d="m4.5 9.5 3.5-3.5 3.5 3.5"/>'),
  close: svg('<path d="m4.5 4.5 7 7m0-7-7 7"/>'),
  more: svg('<circle cx="3.5" cy="8" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/><circle cx="12.5" cy="8" r=".9" fill="currentColor"/>'),
  send: svg('<path d="M8 12.5v-9M4.5 7 8 3.5 11.5 7"/>'),
  plus: svg('<path d="M8 3.5v9M3.5 8h9"/>'),
  check: svg('<path d="m3.5 8.3 2.9 2.9 6.1-6.4"/>'),
  tag: svg('<path d="M2.5 3.5v3.3c0 .3.1.5.3.7l5.7 5.7a1 1 0 0 0 1.4 0l3.3-3.3a1 1 0 0 0 0-1.4L7.5 2.8a1 1 0 0 0-.7-.3H3.5a1 1 0 0 0-1 1z"/><circle cx="5.3" cy="5.3" r=".9" fill="currentColor" stroke="none"/>'),
  user: svg('<circle cx="8" cy="8" r="5.75" stroke-dasharray="2.2 2.1"/><circle cx="8" cy="6.9" r="1.7"/><path d="M5.3 11.4c.6-1.2 1.6-1.8 2.7-1.8s2.1.6 2.7 1.8"/>'),
  sparkle: svg('<path d="M8 2.5c.4 2.7 1.3 4.2 5 5.5-3.7 1.3-4.6 2.8-5 5.5-.4-2.7-1.3-4.2-5-5.5 3.7-1.3 4.6-2.8 5-5.5z" fill="currentColor" stroke="none"/>'),
  external: svg('<path d="M6 3.5H4a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 4 13.5h7a1.5 1.5 0 0 0 1.5-1.5v-2M9 2.5h4.5V7M13.5 2.5 7.5 8.5"/>'),
  link: svg('<path d="M7 9a2.5 2.5 0 0 0 3.5 0l2-2A2.5 2.5 0 0 0 9 3.5l-.7.7M9 7a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12.5l.7-.7"/>'),
  keyboard: svg('<rect x="1.75" y="4" width="12.5" height="8" rx="1.5"/><path d="M4.5 6.5h.01M7 6.5h.01M9.5 6.5h.01M12 6.5h.01M5 9.5h6"/>'),
  power: svg('<path d="M8 2.5v5M4.6 4.6a5 5 0 1 0 6.8 0"/>'),
  refresh: svg('<path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.8v2.7h-2.7"/>'),
  back: svg('<path d="M12.5 8h-9M7 4.5 3.5 8 7 11.5"/>'),
  mail: svg('<rect x="2" y="3.5" width="12" height="9" rx="1.5"/><path d="m2.5 4.5 5.5 4 5.5-4"/>'),
  person: svg('<circle cx="8" cy="5.8" r="2.3"/><path d="M3.8 12.8c.8-2 2.4-3 4.2-3s3.4 1 4.2 3"/>'),
  pricing: svg('<path d="M8 2.5v11M10.8 5.2c-.5-.9-1.5-1.4-2.8-1.4-1.6 0-2.7.8-2.7 2s1 1.7 2.7 2.1 2.8.9 2.8 2.2-1.2 2.1-2.8 2.1c-1.4 0-2.5-.6-3-1.6"/>'),
  team: `<svg class="tk-team" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false"><rect width="18" height="18" rx="5" fill="#2B2F55"/><path d="M5.2 7.4h7.1M10.5 5.6l1.8 1.8-1.8 1.8M12.8 10.6H5.7M7.5 8.8l-1.8 1.8 1.8 1.8" fill="none" stroke="#AAB1FF" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

// Axial's mark: a disc split along its axis, one half shifted, like work moving over.
export const LOGO = `<svg class="ax-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M11.1 2.55a9 9 0 0 0 0 17.9z" fill="currentColor"/><path d="M12.9 5.55a9 9 0 0 1 0 17.9z" fill="currentColor" opacity=".55"/></svg>`;

/**
 * The status icon. One shape for every status, so CSS can animate between
 * them: a ring, a pie that fills as work progresses, and a disc with a mark.
 */
export function statusIcon(status = 'todo', { thinking = false } = {}) {
  return `<svg class="tk-st" viewBox="0 0 14 14" data-status="${status}"${thinking ? ' data-thinking' : ''} aria-hidden="true" focusable="false">`
    + '<circle class="tk-st-ring" cx="7" cy="7" r="6" pathLength="24"/>'
    + '<g class="tk-st-spin"><circle class="tk-st-fill" cx="7" cy="7" r="2.25" pathLength="100" transform="rotate(-90 7 7)"/></g>'
    + '<circle class="tk-st-disc" cx="7" cy="7" r="7"/>'
    + '<path class="tk-st-mark tk-st-check" d="M4.2 7.25 6.1 9.1 9.9 5.1"/>'
    + '<path class="tk-st-mark tk-st-x" d="m4.9 4.9 4.2 4.2m0-4.2L4.9 9.1"/>'
    + '<path class="tk-st-mark tk-st-arrows" d="M4.4 5.9h4.9M8.2 4.7l1.2 1.2-1.2 1.2M9.6 8.1H4.7M5.8 6.9 4.6 8.1l1.2 1.2"/>'
    + '</svg>';
}

export function priorityIcon(priority = 'none') {
  if (priority === 'urgent') {
    return '<svg class="tk-pr" viewBox="0 0 16 16" data-priority="urgent" aria-hidden="true" focusable="false"><rect x="1" y="1" width="14" height="14" rx="3.5" class="tk-pr-urgent"/><path d="M8 4.4v4.3" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="11.4" r="1.05" fill="#fff"/></svg>';
  }
  if (priority === 'none') {
    return '<svg class="tk-pr" viewBox="0 0 16 16" data-priority="none" aria-hidden="true" focusable="false"><path d="M2 8h2.4M6.8 8h2.4M11.6 8H14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  }
  return `<svg class="tk-pr" viewBox="0 0 16 16" data-priority="${priority}" aria-hidden="true" focusable="false">`
    + '<rect class="tk-pr-bar b1" x="1.5" y="9" width="3" height="5" rx="1"/>'
    + '<rect class="tk-pr-bar b2" x="6.5" y="5.5" width="3" height="8.5" rx="1"/>'
    + '<rect class="tk-pr-bar b3" x="11.5" y="2" width="3" height="12" rx="1"/></svg>';
}
