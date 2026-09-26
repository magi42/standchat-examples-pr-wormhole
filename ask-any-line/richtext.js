// Replies are text. This turns them into DOM without ever parsing their HTML:
// paragraphs, line breaks, "- " lists, **bold**, `code`, ``` blocks, http(s)
// links, and [[references]] to parts of the page, which become chips.

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[\[([^\]\n]{1,80})\]\])|(https?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]])/g;

/**
 * renderRich(text, { reference(name) → chip element or null, link(url, anchor) })
 * An unknown reference comes out as its plain name, without brackets.
 */
export function renderRich(text, hooks = {}) {
  const out = document.createDocumentFragment();
  const source = String(text).replace(/\r\n?/g, '\n').trim();
  // Fenced code first: it may hold blank lines.
  const parts = source.split(/^```[^\n]*\n([\s\S]*?)^```[ \t]*$/m);
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = part.replace(/\n$/, '');
      pre.append(code);
      out.append(pre);
      return;
    }
    for (const block of part.split(/\n\s*\n/)) {
      const lines = block.split('\n').filter((l) => l.trim());
      if (!lines.length) continue;
      const bullet = /^\s*(?:[-*•]|\d+[.)])\s+/;
      if (lines.every((l) => bullet.test(l))) {
        const list = document.createElement(/^\s*\d/.test(lines[0]) ? 'ol' : 'ul');
        for (const line of lines) {
          const li = document.createElement('li');
          li.append(inline(line.replace(bullet, ''), hooks));
          list.append(li);
        }
        out.append(list);
      } else {
        const p = document.createElement('p');
        lines.forEach((line, n) => {
          if (n) p.append(document.createElement('br'));
          p.append(inline(line, hooks));
        });
        out.append(p);
      }
    }
  });
  return out;
}

function inline(text, hooks) {
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1]) {
      const code = document.createElement('code');
      code.textContent = m[1].slice(1, -1);
      frag.append(code);
    } else if (m[2]) {
      const strong = document.createElement('strong');
      strong.textContent = m[2].slice(2, -2);
      frag.append(strong);
    } else if (m[3]) {
      const name = m[4].trim();
      frag.append(hooks.reference?.(name) ?? name);
    } else {
      frag.append(link(m[5], hooks) ?? m[5]);
    }
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

function link(raw, hooks) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const a = document.createElement('a');
  a.href = url.href;
  a.textContent = raw;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  hooks.link?.(url.href, a);
  return a;
}

/** Plain text for screen-reader announcements: no brackets, no markup. */
export function plainText(text) {
  return String(text)
    .replace(/\[\[([^\]\n]{1,80})\]\]/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/`{1,3}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
