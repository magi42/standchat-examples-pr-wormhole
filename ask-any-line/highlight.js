// A small syntax highlighter for the quickstart's five languages. One line at a
// time, which is all a line-by-line code view needs. Not a parser: good enough
// for code we wrote ourselves.

const KEYWORDS = {
  js: 'async await break case catch class const else export false for from function if import in let new null of return this throw true try typeof undefined',
  python: 'and as def elif else except False for from if import in is None not or return True try with',
  ruby: 'begin def do else end ensure false if nil require rescue return true unless',
  go: 'func package import var const return if else for range struct map string nil type',
  sh: 'export',
};
const CONSTANTS = /^(true|false|null|undefined|None|True|False|nil)$/;

const escape = (text) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// One regex per language: the first alternative that matches at a position wins.
const PATTERNS = {
  js: /(\/\/.*$)|(`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")|\b(\d[\d_]*(?:\.\d+)?)\b|([A-Za-z_$][\w$]*)(?=\s*\()|(?<=\.)([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)(?=\s*:(?!:))|([A-Za-z_$][\w$]*)/gm,
  python: /(#.*$)|(f?"(?:\\.|[^"\\])*"|f?'(?:\\.|[^'\\])*')|\b(\d[\d_]*(?:\.\d+)?)\b|(@[\w.]+)|([A-Za-z_]\w*)(?=\s*\()|(?<=\.)([A-Za-z_]\w*)|([A-Za-z_]\w*)(?==(?!=))|([A-Za-z_]\w*)/gm,
  ruby: /(#.*$)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\b(\d[\d_]*(?:\.\d+)?)\b|(:[a-z_]\w*)|([A-Za-z_]\w*[?!]?)(?=\()|(?<=\.)([A-Za-z_]\w*[?!]?)|([a-z_]\w*)(?=:\s)|([A-Za-z_]\w*[?!]?)/gm,
  go: /(\/\/.*$)|(`[^`]*`|"(?:\\.|[^"\\])*")|\b(\d[\d_]*(?:\.\d+)?)\b|([A-Za-z_]\w*)(?=\()|(?<=\.)([A-Za-z_]\w*)|([A-Z]\w*)(?=:)|([A-Za-z_]\w*)/gm,
  sh: /(#.*$)|("(?:\\.|[^"\\])*"|'[^']*')|(\s--?[a-z][\w-]*)|(\$\w+|\$\{\w+\})|\b(\d+)\b|(^\s*[a-z][\w-]*)|([A-Za-z_][\w./:-]*)/gm,
};

/** Returns the line as HTML: escaped text in spans with t-* classes. */
export function highlightLine(text, lang) {
  const pattern = PATTERNS[lang];
  if (!pattern) return escape(text);
  const keywords = new Set(KEYWORDS[lang].split(' '));
  let html = '';
  let last = 0;
  pattern.lastIndex = 0;
  for (const m of text.matchAll(pattern)) {
    html += punct(text.slice(last, m.index));
    last = m.index + m[0].length;
    html += token(m, lang, keywords);
  }
  return html + punct(text.slice(last));
}

function token(m, lang, keywords) {
  const word = m[0];
  const span = (kind, value = word) => `<span class="t-${kind}">${escape(value)}</span>`;
  if (m[1]) return span('com');
  if (m[2]) return span('str');

  if (lang === 'sh') {
    if (m[3]) return escape(word.match(/^\s*/)[0]) + span('flag', word.trim());
    if (m[4]) return span('var');
    if (m[5]) return span('num');
    if (m[6]) return escape(word.match(/^\s*/)[0]) + span(keywords.has(word.trim()) ? 'key' : 'fn', word.trim());
    return escape(word);
  }

  if (m[3]) return span('num');
  if (lang === 'python' && m[4]) return span('dec');
  if (lang === 'ruby' && m[4]) return span('sym');
  const fnGroup = lang === 'python' || lang === 'ruby' ? 5 : 4;
  const propGroup = fnGroup + 1;
  const keyGroup = fnGroup + 2;
  if (m[fnGroup]) return keywords.has(word) ? span('key') : span('fn');
  if (m[propGroup]) return span('prop');
  if (m[keyGroup]) return keywords.has(word) ? span('key') : span('attr');
  if (CONSTANTS.test(word)) return span('const');
  if (keywords.has(word)) return span('key');
  if (/^[A-Z]/.test(word)) return span('type');
  return escape(word);
}

// Brackets, operators and the like: a quieter color.
function punct(text) {
  if (!text) return '';
  // Entities first, so a `;` never splits one.
  return escape(text).replace(/(=&gt;|&lt;|&gt;|&amp;|&quot;|[{}()[\];,.=:+|!*/-]+)/g, '<span class="t-p">$1</span>');
}
