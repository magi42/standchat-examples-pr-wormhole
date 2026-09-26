// A small SQL tokenizer for the playground: highlighting, splitting a script
// into statements, and telling a query from a schema change. Not a parser, but
// it knows about strings, dollar quotes, quoted names and comments.

const KEYWORDS = new Set(`
  add all alter always analyze and any as asc begin between by cascade case check column comment commit
  constraint create cross current_role current_user default definer delete desc disable distinct do drop
  else enable end except execute exists explain false filter first for foreign from full function generated
  grant group having identity if ilike immutable in inherit inner insert intersect into invoker is join
  language last lateral left level like limit local login noinherit nologin bypassrls not notice null nulls
  of offset on only or order outer over owner partition permissive policy primary privileges procedure raise
  references rename replace reset restrict restrictive returning returns revoke right role rollback row rows
  schema security select session session_user set show some stable table then to transaction trigger true
  truncate union unique update usage using values view volatile when where window with
`.trim().split(/\s+/));

const TYPES = new Set(`
  bigint bigserial bool boolean bytea char date decimal float float4 float8 int int2 int4 int8 integer
  interval json jsonb numeric real serial smallint text time timestamp timestamptz uuid varchar
`.trim().split(/\s+/));

const PATTERN = new RegExp([
  /(?<ws>\s+)/,
  /(?<comment>--[^\n]*|\/\*[\s\S]*?(?:\*\/|$))/,
  /(?<dollar>\$(?<tag>[A-Za-z_]\w*)?\$[\s\S]*?(?:\$\k<tag>\$|$))/,
  /(?<string>[EeBbXx]?'(?:[^']|'')*(?:'|$))/,
  /(?<quoted>"(?:[^"]|"")*(?:"|$))/,
  /(?<param>\$\d+)/,
  /(?<number>\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+)/,
  /(?<word>[A-Za-z_][\w$]*)/,
  /(?<op>::|->>|->|#>>|#>|<>|!=|<=|>=|\|\||[-+*/%<>=~!@#^&|?])/,
  /(?<punct>[(),;.[\]{}:])/,
  /(?<other>.)/,
].map((r) => r.source).join('|'), 'gy');

/** Splits SQL into tokens: { type, text, start }. */
export function tokenize(sql) {
  const tokens = [];
  PATTERN.lastIndex = 0;
  let m;
  while (PATTERN.lastIndex < sql.length && (m = PATTERN.exec(sql))) {
    const g = m.groups;
    const type = Object.keys(g).find((k) => k !== 'tag' && g[k] !== undefined);
    tokens.push({ type, text: m[0], start: m.index });
  }
  return tokens;
}

const escapeHtml = (text) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Highlighted HTML for SQL text. Everything is escaped; only spans are added. */
export function highlight(sql) {
  const tokens = tokenize(sql);
  let html = '';
  for (let i = 0; i < tokens.length; i++) {
    const { type, text } = tokens[i];
    let cls = '';
    if (type === 'comment') cls = 'com';
    else if (type === 'string' || type === 'dollar') cls = 'str';
    else if (type === 'number' || type === 'param') cls = 'num';
    else if (type === 'quoted') cls = 'qid';
    else if (type === 'op') cls = 'op';
    else if (type === 'word') {
      const lower = text.toLowerCase();
      const next = tokens.slice(i + 1).find((t) => t.type !== 'ws');
      const prev = tokens.slice(0, i).findLast((t) => t.type !== 'ws');
      if (prev?.text === '.' && next?.text !== '(') cls = '';
      else if (next?.text === '(' && !KEYWORDS.has(lower)) cls = 'fn';
      else if (TYPES.has(lower)) cls = 'type';
      else if (KEYWORDS.has(lower)) cls = lower === 'true' || lower === 'false' || lower === 'null' ? 'const' : 'kw';
    }
    html += cls ? `<span class="t-${cls}">${escapeHtml(text)}</span>` : escapeHtml(text);
  }
  return html;
}

/** Statements in a script, with comments kept but empty statements dropped. */
export function splitStatements(sql) {
  const statements = [];
  let start = 0;
  let meaningful = false;
  const push = (end) => {
    const text = sql.slice(start, end);
    if (meaningful) statements.push({ text: text.trim(), start, end });
    meaningful = false;
  };
  for (const t of tokenize(sql)) {
    if (t.type === 'punct' && t.text === ';') {
      push(t.start + 1);
      start = t.start + 1;
    } else if (t.type !== 'ws' && t.type !== 'comment') {
      meaningful = true;
    }
  }
  push(sql.length);
  return statements;
}

const words = (sql) => tokenize(sql).filter((t) => t.type === 'word' || (t.type === 'punct' && t.text === '('));

/** A statement's command, like SELECT, UPDATE or CREATE POLICY. */
export function commandOf(statement) {
  const list = words(statement).filter((t) => t.type === 'word').map((t) => t.text.toUpperCase());
  const [first, second] = list;
  if (!first) return '';
  if (first === 'WITH') {
    // The main statement after the CTEs: the first verb outside parentheses.
    let depth = 0;
    for (const t of tokenize(statement)) {
      if (t.text === '(') depth++;
      else if (t.text === ')') depth--;
      else if (depth === 0 && t.type === 'word' && /^(select|insert|update|delete)$/i.test(t.text)) return t.text.toUpperCase();
    }
    return 'SELECT';
  }
  if (['CREATE', 'ALTER', 'DROP', 'COMMENT'].includes(first)) {
    const object = list.slice(1).find((w) => !['OR', 'REPLACE', 'UNIQUE', 'TEMP', 'TEMPORARY', 'IF', 'NOT', 'EXISTS'].includes(w));
    return object ? `${first} ${object === 'MATERIALIZED' ? 'VIEW' : object}` : first;
  }
  if (first === 'SET' || first === 'RESET') return second === 'ROLE' ? `${first} ROLE` : first;
  return first;
}

const SCHEMA = /^(CREATE|ALTER|DROP|GRANT|REVOKE|COMMENT)\b/;

/** True when a script changes the schema: the owner (here, service_role) runs those. */
export function changesSchema(sql) {
  return splitStatements(sql).some((s) => SCHEMA.test(commandOf(s.text)));
}

/** Known table names mentioned in the SQL, in order of first mention. */
export function tablesIn(sql, known) {
  const names = new Set(known.map((n) => n.toLowerCase()));
  const found = [];
  for (const t of tokenize(sql)) {
    const name = t.type === 'quoted' ? t.text.slice(1, -1).replace(/""/g, '"') : t.type === 'word' ? t.text : '';
    const lower = name.toLowerCase();
    if (names.has(lower) && !found.includes(lower)) found.push(lower);
  }
  return found;
}

/** 1-based line and column for a character position (Postgres reports 1-based positions). */
export function lineOf(sql, position) {
  const before = sql.slice(0, Math.max(0, position - 1));
  const lines = before.split('\n');
  return { line: lines.length, column: lines.at(-1).length + 1 };
}
