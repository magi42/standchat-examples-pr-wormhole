// The conversation model, without any DOM: how a question and the playground's
// context become one message, how that message reads back after a reload, the
// private prompt for whoever answers, and the page parts a reply may point at.

// Private context for the AI Stand-in and the team, sent with the first message.
// It's in the page's source, so it holds nothing secret. Stand accepts up to 2,000 characters.
export const PROMPT = [
  `You are answering visitors on the website of Basalt, a fictional hosted Postgres platform (a demo on examples.stand.chat; Basalt is invented). Speak as Basalt's team. Reply in 1-3 sentences unless asked more. If a fact isn't below, say you're not sure and offer to bring in someone from the team. Don't invent prices, limits or features.`,
  `Basalt: Postgres 18 with auth, storage, realtime, functions, vectors; open source (Apache 2.0). Free $0: 2 projects, 750 MB DB, 1 GB storage, 5 GB egress, 25k MAU, pauses after 10 idle days. Pro from $29/mo per project: 10 GB DB, 100k MAU, 7-day backups, point-in-time recovery +$100/mo. Team from $499/mo: SSO, SOC 2 report, 14-day backups, priority support. Enterprise: custom, HIPAA, 99.95% SLA.`,
  `The playground runs real Postgres in the browser. Tables: organizations(id, name), profiles(id uuid, full_name), members(org_id, user_id, role admin|member), projects(id, org_id, name, status), invoices(id, org_id, project_id, number, amount_cents, status draft|sent|paid, due_on). auth.uid() is the JWT sub; is_member(org_id), is_admin(org_id).`,
  `Users: Ada Moreau, member of Acme (org 1); Bo Lindqvist, admin of Acme; Cy Okafor, member of Globex (org 2); Dee Tanaka, admin of Globex. Roles: anon, authenticated, service_role (bypasses RLS, may change schema).`,
  `Policies for authenticated. SELECT: "members read their orgs", "members read teammates", "teammates read profiles", "members read org projects", "admins read invoices". INSERT: "members create projects", "admins create invoices". UPDATE: "users update own profile". anon has none. 0 rows often means RLS hid them. Invoice DELETEs fail before RLS: no grant.`,
  `Messages start with [as <user> · <result>], then the question and maybe SQL. When SQL helps, write complete, valid Postgres in a \`\`\`sql block (to change a policy, drop and recreate it): the visitor can run it with one click. Cite the deciding policy or table by exact name, as [[policy: name]] or [[table: name]], at most two.`,
].join('\n');

const MAX_QUESTION = 1200;
const MAX_SQL = 1500;

/**
 * One message: the context prefix, the question, and the SQL on the next lines.
 *
 *   [as Cy · ERROR 42501: new row violates row-level security policy for table "invoices"] Why did this fail?
 *   ```sql
 *   insert into invoices (org_id, project_id, number, amount_cents, due_on) …
 *   ```
 */
export function composeMessage(question, context) {
  const text = String(question ?? '').trim().slice(0, MAX_QUESTION);
  if (!context?.userLabel) return text;
  const parts = [
    `as ${context.userLabel}`,
    outcomeText(context.outcome),
    context.policy ? `policy "${context.policy}"` : '',
    context.changes ? `changed: ${context.changes}` : '',
  ].filter(Boolean).map(clean);
  let body = `[${parts.join(' · ')}] ${text}`;
  const sql = String(context.sql ?? '').trim();
  if (sql) body += `\n\`\`\`sql\n${sql.length > MAX_SQL ? `${sql.slice(0, MAX_SQL)}\n-- (cut)` : sql}\n\`\`\``;
  return body;
}

export function outcomeText(outcome) {
  if (!outcome) return '';
  if (outcome.kind === 'error') return `ERROR${outcome.code ? ` ${outcome.code}` : ''}: ${outcome.message}`;
  if (outcome.kind === 'rows') return `${outcome.count} row${outcome.count === 1 ? '' : 's'}`;
  if (outcome.kind === 'table') return `table ${outcome.table}: ${outcome.visible} of ${outcome.total} rows visible`;
  if (outcome.kind === 'command') {
    return /^(INSERT|UPDATE|DELETE|MERGE)$/.test(outcome.command) && Number.isFinite(outcome.affected)
      ? `${outcome.command} ${outcome.affected}`
      : outcome.command || 'OK';
  }
  return '';
}

// Parts stay on one line, with no brackets or separators inside, so they parse back.
const clean = (part) => part.replace(/[\][\r\n]+/g, ' ').replace(/·/g, '-').replace(/\s+/g, ' ').trim().slice(0, 240);

const PREFIX = /^\[as ([^\]\n]{1,600})\] ?/;

/** Reads a visitor message back into its question and context: after a reload, from the transcript alone. */
export function parseMessage(body) {
  const text = String(body ?? '');
  const match = PREFIX.exec(text);
  if (!match) return { question: text.trim(), context: null };
  const [userLabel, ...parts] = match[1].split(' · ');
  const context = { userLabel: userLabel.trim(), outcome: null, policy: '', changes: '', sql: '' };
  for (const part of parts) {
    let m;
    if ((m = /^ERROR(?: (\w{5}))?: ([\s\S]*)$/.exec(part))) context.outcome = { kind: 'error', code: m[1] ?? '', message: m[2] };
    else if ((m = /^(\d+) rows?$/.exec(part))) context.outcome = { kind: 'rows', count: Number(m[1]) };
    else if ((m = /^(INSERT|UPDATE|DELETE|MERGE) (\d+)$/.exec(part))) context.outcome = { kind: 'command', command: m[1], affected: Number(m[2]) };
    else if ((m = /^table (\S+): (\d+) of (\d+) rows visible$/.exec(part))) context.outcome = { kind: 'table', table: m[1], visible: Number(m[2]), total: Number(m[3]) };
    else if ((m = /^policy "(.+)"$/.exec(part))) context.policy = m[1];
    else if ((m = /^changed: (.+)$/.exec(part))) context.changes = m[1];
    else if (/^[A-Z]+(?: [A-Z]+)*$/.test(part)) context.outcome = { kind: 'command', command: part };
  }
  let rest = text.slice(match[0].length);
  const fence = /\n```sql\n([\s\S]*?)\n```\s*$/.exec(rest);
  if (fence) {
    context.sql = fence[1];
    rest = rest.slice(0, fence.index);
  }
  return { question: rest.trim(), context };
}

/** Names compare case-insensitively, with quotes, extra spaces and trailing punctuation ignored. */
export function normalizeName(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[“”"'`]/g, '')
    .trim()
    .replace(/^public\./, '')
    .replace(/\s+/g, ' ')
    .replace(/[\s.,;:!?]+$/, '')
    .trim();
}

/** "[[table: invoices]]" → { kind: 'table', name: 'invoices' }. Without a kind, the page tries both. */
export function parseRef(raw) {
  const m = /^\s*(tables?|polic(?:y|ies))\s*:\s*(.+)$/i.exec(String(raw ?? ''));
  if (!m) return { kind: null, name: normalizeName(raw) };
  return { kind: /^t/i.test(m[1]) ? 'table' : 'policy', name: normalizeName(m[2]) };
}
