// Visit analytics for examples.stand.chat: stand.chat's PostHog project and
// settings. Site chrome like the top bar: it does nothing anywhere but the live
// site, and copied examples never load it.
//
// There's no cookie banner. PostHog sets cookies only where stand.chat would:
// after the visitor accepted on stand.chat, whose consent cookie every
// *.stand.chat site shares, or without an answer when the browser doesn't look
// European. Everyone else is counted cookieless: nothing is stored in the
// browser, PostHog tells visitors apart by a daily hash on its servers, and
// there are no session replays.
//
// Cookieless events need "Cookieless server hash mode" turned on in PostHog,
// under Project settings > Web analytics. While it's off, PostHog drops them.

const SITE = 'examples.stand.chat';
const POSTHOG_KEY = 'phc_rFZ3k8vksGJeXGAha2WYy8jmtW8okRRDkyDdjXfD8J89';
const POSTHOG_HOST = 'https://k.stand.chat'; // stand.chat's proxy for PostHog
const CONSENT_COOKIE = 'stand_chat_consent_v1'; // "accepted" or "rejected"
// Where stand.chat asks first: the EEA and the UK, by browser language region.
const EUROPE = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT',
  'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB', 'UK',
]);

// stand.chat's rule for non-essential cookies: yes after Accept, no after Reject,
// and without an answer, no when the browser looks European.
function cookiesAllowed() {
  const cookie = document.cookie.split('; ').find((c) => c.startsWith(`${CONSENT_COOKIE}=`));
  const consent = cookie?.slice(CONSENT_COOKIE.length + 1);
  if (consent === 'accepted' || consent === 'rejected') return consent === 'accepted';
  return !looksEuropean();
}

// stand.chat's test: a European region in any browser language, or a European time zone.
function looksEuropean() {
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  if (languages.some((tag) => EUROPE.has(tag?.split(/[-_]/)[1]?.toUpperCase()))) return true;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone.startsWith('Europe/');
  } catch {
    return false;
  }
}

function startPostHog({ cookieless }) {
  const script = Object.assign(document.createElement('script'), { src: `${POSTHOG_HOST}/static/array.js` });
  script.addEventListener('load', () => {
    // stand.chat's settings. It sends its own pageviews as a single-page app; here PostHog sends one per page.
    window.posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      ui_host: 'https://us.posthog.com',
      person_profiles: 'identified_only',
      autocapture: true,
      capture_pageleave: true,
      session_recording: { blockSelector: '.ph-no-capture', maskAllInputs: true },
      ...(cookieless && { cookieless_mode: 'always' }),
    });
    // Back and Forward can restore a page from the browser's cache without rerunning
    // its scripts, so PostHog wouldn't count that view. Going back to the gallery does this.
    addEventListener('pageshow', (event) => {
      if (event.persisted) window.posthog.capture('$pageview');
    });
  });
  document.head.append(script);
}

if (location.hostname === SITE) startPostHog({ cookieless: !cookiesAllowed() });
