// Site chrome for example pages: the top bar, a note when the chat is missing,
// the code blocks in the "How it works" section, and the site's analytics
// (analytics.js). Every example must also work without this file, for example
// after copying its folder.

// Third-party marks load from a CDN: this repository is public domain.
const GITHUB_MARK = 'https://cdn.jsdelivr.net/npm/simple-icons@15/icons/github.svg';
const REPO = 'https://github.com/standchat/examples';
const previewing = new URLSearchParams(location.search).has('preview');

function renderBar() {
  let host = document.querySelector('sx-example-bar');
  if (!host) {
    host = document.createElement('sx-example-bar');
    document.body.prepend(host);
  }
  const slug = location.pathname.split('/').filter(Boolean)[0] ?? '';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>${BAR_CSS}</style>
    <header>
      <a class="home" href="/">Stand Chat Examples</a>
      <span class="slash" aria-hidden="true">/</span>
      <span class="title"></span>
      <span class="author" hidden>by <a></a></span>
      <span class="grow"></span>
      <span class="status" role="status" hidden><i aria-hidden="true"></i><span class="label"></span></span>
      <a class="how" href="#how-it-works">How it works <span aria-hidden="true">↓</span></a>
      <a class="github" href="${REPO}/tree/main/${encodeURIComponent(slug)}/" title="Source on GitHub" aria-label="Source on GitHub"><span aria-hidden="true"></span></a>
    </header>`;

  root.querySelector('.title').textContent = document.title;
  // Use the same author metadata that build.mjs includes in the gallery.
  const name = document.querySelector('meta[name="author"]')?.content?.trim();
  if (name) {
    const author = root.querySelector('.author a');
    author.textContent = name;
    const url = document.querySelector('link[rel~="author"]')?.href;
    if (url) author.href = url;
    root.querySelector('.author').hidden = false;
  }
  if (!document.getElementById('how-it-works')) root.querySelector('.how').remove();

  watchStand(root.querySelector('.status'));
}

// Silent while the chat works: the chat itself shows that. Speaks up only when
// the Stand UI is missing, so nobody mistakes that for a broken example.
function watchStand(pill) {
  // Custom chat UIs call Stand's API without stand.js and show their own status.
  if (!document.querySelector('script[src*="stand.js"]')) return;
  const show = (label, detail) => {
    pill.querySelector('.label').textContent = label;
    pill.title = detail;
    pill.hidden = false;
  };
  if (previewing) show('Preview', 'Hidden Stand elements are forced visible for layout work. They only work while Stand is available.');
  let tries = 0;

  (function attach() {
    const stand = window.StandChat;
    if (!stand) {
      if (++tries < 100) return void setTimeout(attach, 100);
      return show('Chat didn’t load', 'stand.js did not load: blocked by an extension, offline, or missing from this page.');
    }
    stand.whenAvailable(() => {
      if (!previewing) pill.hidden = true;
    });
    setTimeout(() => {
      if (stand.isAvailable() || previewing) return;
      show(
        'Chat offline',
        'Stand found no available rep or AI Stand-in for this page right now, so the chat and its buttons stay hidden. ' +
          'Add ?preview to the URL to show them for layout work.',
      );
    }, 8000);
  })();
}

// ?preview: shows the Stand elements that stay hidden until someone is
// available. Useful on localhost, where Stand doesn't answer. Clicking them
// does nothing unless Stand is available.
function forcePreview() {
  const reveal = () => {
    for (const el of document.querySelectorAll('stand-button[hidden], stand-card[hidden], [data-stand-reveal][hidden]')) {
      el.hidden = false;
    }
    for (const el of document.querySelectorAll('[data-stand-availability-hidden]')) {
      el.removeAttribute('data-stand-availability-hidden');
    }
    // Without a responder there is no avatar URL; show the mascot, not an empty image.
    for (const el of document.querySelectorAll('stand-button, stand-card')) {
      const img = el.shadowRoot?.querySelector('img:not([src])');
      if (img) img.style.display = 'none';
    }
  };
  reveal();
  customElements.whenDefined('stand-button').then(reveal);
  customElements.whenDefined('stand-card').then(reveal);
  new MutationObserver(reveal).observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden', 'data-stand-availability-hidden'],
  });
}

function enhanceCodeBlocks() {
  const highlighters = { html: highlightHtml, js: highlightJs, css: highlightCss };
  for (const pre of document.querySelectorAll('pre.sx-code')) {
    const code = pre.querySelector('code') ?? pre;
    const source = code.textContent;
    const language = code.className.match(/language-(\w+)/)?.[1];
    if (highlighters[language]) code.innerHTML = highlighters[language](source);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sx-copy';
    button.textContent = 'Copy';
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(source.trim());
        button.textContent = 'Copied';
      } catch {
        getSelection().selectAllChildren(code);
        button.textContent = 'Selected';
      }
      setTimeout(() => (button.textContent = 'Copy'), 1600);
    });
    pre.append(button);
  }
}

// A tiny syntax highlighter for the snippets on these pages. Not a parser.
const escapeHtml = (text) =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const token = (kind, text) => `<span class="sx-${kind}">${escapeHtml(text)}</span>`;

function scan(source, pattern, render) {
  let html = '';
  let last = 0;
  for (const match of source.matchAll(pattern)) {
    html += escapeHtml(source.slice(last, match.index)) + render(match);
    last = match.index + match[0].length;
  }
  return html + escapeHtml(source.slice(last));
}

function highlightJs(source) {
  const pattern =
    /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(`(?:\\[\s\S]|[^\\`])*`|'(?:\\.|[^\\'\n])*'|"(?:\\.|[^\\"\n])*")|\b(async|await|break|case|catch|class|const|continue|default|else|export|false|for|from|function|if|import|in|let|new|null|of|return|switch|this|throw|true|try|typeof|undefined|while)\b|\b(\d+(?:\.\d+)?)\b|([A-Za-z_$][\w$]*)(?=\s*\()/g;
  return scan(source, pattern, (m) =>
    m[1] ? token('com', m[0])
      : m[2] ? token('str', m[0])
      : m[3] ? token('key', m[0])
      : m[4] ? token('num', m[0])
      : token('fn', m[0]),
  );
}

function highlightCss(source) {
  let depth = 0;
  const pattern =
    /(\/\*[\s\S]*?\*\/)|([{}])|("[^"\n]*"|'[^'\n]*')|(::?[\w-]+(?:\([^)\n]*\))?)|([\w-]+)(?=\s*:\s)|(#[\da-fA-F]{3,8}\b|-?\d*\.?\d+(?:[a-z%]+)?)/g;
  return scan(source, pattern, (m) => {
    if (m[1]) return token('com', m[0]);
    if (m[2]) {
      depth += m[2] === '{' ? 1 : -1;
      return escapeHtml(m[0]);
    }
    if (m[3]) return token('str', m[0]);
    if (m[4] && depth === 0) return token('key', m[0]);
    if (m[5] && depth > 0) return token('attr', m[0]);
    if (m[6] && depth > 0) return token('num', m[0]);
    return escapeHtml(m[0]);
  });
}

function highlightHtml(source) {
  const pattern =
    /(<!--[\s\S]*?-->)|(<script\b[^>]*>)([\s\S]*?)(<\/script>)|(<style\b[^>]*>)([\s\S]*?)(<\/style>)|(<\/?[a-zA-Z][\w-]*(?:"[^"]*"|'[^']*'|[^'">])*>)/g;
  return scan(source, pattern, (m) => {
    if (m[1]) return token('com', m[0]);
    if (m[2]) return highlightTag(m[2]) + highlightJs(m[3]) + highlightTag(m[4]);
    if (m[5]) return highlightTag(m[5]) + highlightCss(m[6]) + highlightTag(m[7]);
    return highlightTag(m[8]);
  });
}

function highlightTag(tag) {
  const [, open, name, rest, close] = tag.match(/^(<\/?)([\w-]+)([\s\S]*?)(\/?>)$/);
  const attributes = scan(rest, /([^\s=]+)(?:(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'>]+))?/g, (m) =>
    token('attr', m[1]) + (m[2] ? escapeHtml(m[2]) + token('str', m[3]) : ''),
  );
  return escapeHtml(open) + token('tag', name) + attributes + escapeHtml(close);
}

const BAR_CSS = `
  :host { all: initial; display: block; }
  * { box-sizing: border-box; }
  header {
    display: flex; align-items: center; gap: 12px;
    height: 40px; padding: 0 16px;
    background: #111; color: #A8A8A8;
    font: 400 13.5px/1 'PT Sans', ui-sans-serif, system-ui, -apple-system, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  [hidden] { display: none !important; }
  a { color: inherit; text-decoration: none; border-radius: 6px; }
  a:focus-visible { outline: 2px solid #38B9E0; outline-offset: 2px; }
  .home { color: #fff; font: 700 13.5px/1 'PT Sans Caption', 'PT Sans', ui-sans-serif, system-ui, sans-serif; white-space: nowrap; }
  .slash { color: #444; }
  .title { min-width: 0; overflow: hidden; color: #E6E6E6; text-overflow: ellipsis; white-space: nowrap; }
  .author { min-width: 0; max-width: 25%; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; font-size: 12px; white-space: nowrap; }
  .author a[href] { text-decoration: underline; text-decoration-color: #555; text-underline-offset: 2px; }
  .author a[href]:hover { color: #fff; }
  .author a:focus-visible { outline-offset: -1px; }
  .grow { flex: 1; }
  .status {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 5px 10px; border-radius: 999px;
    background: rgba(246, 197, 16, .12); color: #F6C510;
    font-size: 12.5px; white-space: nowrap; cursor: help;
  }
  .status i { width: 7px; height: 7px; flex: none; border-radius: 50%; background: currentColor; }
  .how { padding: 6px 2px; color: #E6E6E6; white-space: nowrap; }
  .how:hover { color: #fff; text-decoration: underline; text-underline-offset: 3px; }
  .github { display: inline-flex; margin-right: -6px; padding: 6px; color: #A8A8A8; }
  .github:hover { color: #fff; }
  .github span {
    width: 18px; height: 18px; background: currentColor;
    -webkit-mask: url(${GITHUB_MARK}) center / contain no-repeat;
    mask: url(${GITHUB_MARK}) center / contain no-repeat;
  }
  @media (max-width: 680px) {
    header { display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto; gap: 2px 8px; padding-block: 4px; }
    .home { grid-column: 1; grid-row: 1; }
    .author { grid-column: 1; grid-row: 2; max-width: none; }
    .slash, .title, .grow { display: none; }
    .status { grid-column: 2; grid-row: 1 / 3; padding: 0; background: none; }
    .status .label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    .how { grid-column: 3; grid-row: 1 / 3; }
    .github { grid-column: 4; grid-row: 1 / 3; }
  }
`;

// An empty icon: no favicon request, and no Stand brand art in a public-domain site.
if (!document.querySelector('link[rel~="icon"]')) {
  document.head.append(Object.assign(document.createElement('link'), { rel: 'icon', href: 'data:,' }));
}
renderBar();
enhanceCodeBlocks();
if (previewing) forcePreview();
// Imported on its own, so a blocker that stops it leaves the bar alone.
import('./analytics.js').catch(() => {});
