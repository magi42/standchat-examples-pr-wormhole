// Replies are text. This reads one into a small tree: paragraphs, lists, fenced
// code, bold, inline code, links and [[references]]. It never produces HTML:
// assistant.js builds DOM nodes from the tree, with text as text.

/** Blocks: { type: 'p', inline } | { type: 'list', ordered, items: [inline] } | { type: 'code', lang, text } */
export function parseReply(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let para = [];
  let list = null;
  const flushPara = () => {
    if (para.length) blocks.push({ type: 'p', inline: parseInline(para.join('\n')) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*```\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      flushPara();
      flushList();
      const body = [];
      for (i++; i < lines.length && !/^\s*```\s*$/.test(lines[i]); i++) body.push(lines[i]);
      blocks.push({ type: 'code', lang: fence[1].toLowerCase(), text: body.join('\n').replace(/\s+$/, '') });
      continue;
    }
    const item = /^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (item) {
      flushPara();
      const ordered = Boolean(item[2]);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { type: 'list', ordered, start: ordered ? Number(item[2]) : 1, items: [] };
      }
      list.items.push(parseInline(item[3]));
      continue;
    }
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) {
      // A wrapped list item.
      const last = list.items.pop();
      list.items.push([...last, { type: 'text', text: ' ' }, ...parseInline(line.trim())]);
      continue;
    }
    flushList();
    para.push(line.replace(/^#{1,6}\s+/, ''));
  }
  flushPara();
  flushList();
  return blocks;
}

const INLINE = /\[\[([^\]\n]{1,120})\]\]|\*\*([^*\n]+)\*\*|`([^`\n]+)`|\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()[\]]*[^\s<>()[\].,;:!?'"])/g;

/** Inline nodes: text, bold, code, link, ref. */
export function parseInline(text) {
  const nodes = [];
  let last = 0;
  for (const m of String(text).matchAll(INLINE)) {
    if (m.index > last) nodes.push({ type: 'text', text: text.slice(last, m.index) });
    if (m[1] !== undefined) nodes.push({ type: 'ref', raw: m[1] });
    else if (m[2] !== undefined) nodes.push({ type: 'bold', children: parseInline(m[2]) });
    else if (m[3] !== undefined) {
      // A reference in backticks is still a reference.
      const ref = /^\[\[([^\]\n]{1,120})\]\]$/.exec(m[3].trim());
      nodes.push(ref ? { type: 'ref', raw: ref[1] } : { type: 'code', text: m[3] });
    }
    else if (m[4] !== undefined) nodes.push({ type: 'link', href: m[5], text: m[4] });
    else nodes.push({ type: 'link', href: m[6], text: m[6] });
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push({ type: 'text', text: text.slice(last) });
  return nodes;
}

/** Plain text for screen-reader announcements and previews. */
export function plainText(text) {
  return String(text ?? '')
    .replace(/```[\w+-]*\n([\s\S]*?)```/g, (_, code) => `${code.trim()} `)
    .replace(/\[\[(?:(?:table|policy)\s*:\s*)?([^\]]+)\]\]/gi, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Only http(s) links leave the page. */
export function safeUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}
