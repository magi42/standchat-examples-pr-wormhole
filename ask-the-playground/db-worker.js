// The playground's Postgres: PGlite (Postgres compiled to WebAssembly) in a
// worker, so the page never stutters while it downloads, starts, or runs a slow
// query. db.js talks to it with small messages; one request runs at a time.

import { PGLITE, SEED_SQL } from './sandbox.js';
import { commandOf, splitStatements } from './sql.js';

// Uncompressed sizes of the pinned version, for an honest progress bar.
const FILES = { 'pglite.wasm': 10088161, 'initdb.wasm': 395242, 'pglite.data': 6295316 };
const TOTAL = Object.values(FILES).reduce((a, b) => a + b, 0);
const ROLES = new Set(['anon', 'authenticated', 'service_role']);
const ROW_LIMIT = 500;

let PGlite;
let assets = {};
let db;
const received = {};
let lastProgress = 0;

const post = (message) => self.postMessage(message);

// Requests wait for the database, then run strictly one after another: a run
// sets a role, and nothing else may slip in before it's reset.
let queue = boot();
self.onmessage = ({ data }) => {
  queue = queue.then(() => handle(data)).catch(() => {});
};

async function boot() {
  try {
    try {
      const [mod, wasm, initdb, data] = await Promise.all([import(`${PGLITE}index.js`), ...Object.keys(FILES).map(download)]);
      PGlite = mod.PGlite;
      const [pgliteWasmModule, initdbWasmModule] = await Promise.all([WebAssembly.compile(wasm), WebAssembly.compile(initdb)]);
      assets = { pgliteWasmModule, initdbWasmModule, fsBundle: new Blob([data]) };
    } catch {
      // Streaming isn't essential: PGlite can fetch its own files.
      PGlite ??= (await import(`${PGLITE}index.js`)).PGlite;
      assets = {};
    }
    post({ op: 'progress', loaded: TOTAL, total: TOTAL });
    db = await fresh();
    const { rows } = await db.query(`select current_setting('server_version') as version`);
    post({ op: 'ready', version: rows[0]?.version ?? '' });
  } catch (error) {
    post({ op: 'failed', message: String(error?.message ?? error) });
    throw error;
  }
}

async function download(name) {
  const response = await fetch(PGLITE + name);
  if (!response.ok || !response.body) throw new Error(`${name}: ${response.status}`);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    received[name] = size;
    const now = performance.now();
    if (now - lastProgress > 80) {
      lastProgress = now;
      const loaded = Object.values(received).reduce((a, b) => a + b, 0);
      post({ op: 'progress', loaded: Math.min(loaded, TOTAL * 0.99), total: TOTAL });
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

async function fresh() {
  const next = await PGlite.create({ ...assets });
  await next.exec(SEED_SQL);
  return next;
}

async function handle({ id, op, ...args }) {
  try {
    const result = op === 'run' ? await run(args)
      : op === 'inspect' ? await inspect(args)
      : op === 'admin' ? await admin(args)
      : op === 'reset' ? await reset(args)
      : null;
    post({ id, ok: true, result });
  } catch (error) {
    post({ id, ok: false, error: errorOf(error) });
  }
}

// Runs SQL as a role with JWT claims, the way an API request would, then
// resets the session so the next run starts clean.
async function run({ sql, role, claims, limit = ROW_LIMIT }) {
  await become(role, claims);
  const notices = [];
  const started = performance.now();
  try {
    const results = await db.exec(sql, { rowMode: 'array', onNotice: (n) => notices.push(`${n.severity}: ${n.message}`) });
    const ms = performance.now() - started;
    const last = results.at(-1) ?? { rows: [], fields: [] };
    const statements = splitStatements(sql);
    return {
      ok: true,
      ms,
      statements: Math.max(statements.length, 1),
      command: commandOf(statements.at(-1)?.text ?? ''),
      fields: last.fields.map((f) => ({ name: f.name, type: typeName(f.dataTypeID), numeric: NUMERIC.has(f.dataTypeID) })),
      rows: last.rows.slice(0, limit).map((row) => row.map((value, i) => cell(value, last.fields[i]?.dataTypeID))),
      rowCount: last.rows.length,
      affected: last.affectedRows ?? 0,
      notices: notices.slice(0, 5),
    };
  } catch (error) {
    return { ok: false, ms: performance.now() - started, statements: splitStatements(sql).length, error: errorOf(error), notices: notices.slice(0, 5) };
  } finally {
    await settle();
  }
}

async function become(role, claims) {
  if (!ROLES.has(role)) throw new Error(`Unknown role ${role}`);
  await db.exec(`set role ${role}; select set_config('request.jwt.claims', ${literal(JSON.stringify(claims ?? {}))}, false);`);
}

async function settle() {
  try {
    if (db.isInTransaction?.()) await db.exec('rollback');
    await db.exec('reset session authorization; reset role; reset all;');
  } catch {
    await db.exec('rollback; reset session authorization; reset role; reset all;').catch(() => {});
  }
}

// What the dashboard shows beside the editor: tables with row-level security
// flags, columns and row counts (all, and visible to the chosen user),
// policies, and optionally one table's rows as that user sees them.
async function inspect({ role, claims, table, limit = 100 }) {
  const tables = (await db.query(`
    select c.relname as name, c.relrowsecurity as rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    order by c.oid`)).rows;
  const columns = (await db.query(`
    select c.table_name, c.column_name, c.udt_name, c.is_nullable = 'YES' as nullable,
      exists (
        select 1 from information_schema.key_column_usage k
        join information_schema.table_constraints t on t.constraint_name = k.constraint_name and t.constraint_type = 'PRIMARY KEY'
        where k.table_schema = 'public' and k.table_name = c.table_name and k.column_name = c.column_name
      ) as primary_key
    from information_schema.columns c
    where c.table_schema = 'public'
    order by c.table_name, c.ordinal_position`)).rows;
  const policies = (await db.query(`
    select tablename as table, policyname as name, permissive, roles, cmd, qual, with_check
    from pg_policies where schemaname = 'public'
    order by tablename, policyname`)).rows;
  for (const t of tables) {
    t.columns = columns.filter((c) => c.table_name === t.name).map((c) => ({ name: c.column_name, type: c.udt_name, nullable: c.nullable, key: c.primary_key }));
    t.total = Number((await db.query(`select count(*) as n from ${ident(t.name)}`)).rows[0].n);
  }
  let view = null;
  await become(role, claims);
  try {
    for (const t of tables) {
      try {
        t.visible = Number((await db.query(`select count(*) as n from ${ident(t.name)}`)).rows[0].n);
      } catch (error) {
        t.visible = null;
        t.error = errorOf(error);
        await settle();
        await become(role, claims);
      }
    }
  } finally {
    await settle();
  }
  if (table && tables.some((t) => t.name === table)) {
    view = await run({ sql: `select * from ${ident(table)} limit ${Number(limit) || 100}`, role, claims, limit });
  }
  return { tables, policies: policies.map((p) => ({ ...p, roles: [].concat(p.roles ?? []) })), view };
}

// As the owner: switching policies and row-level security on and off.
async function admin({ sql }) {
  await db.exec(sql);
  return { ok: true };
}

async function reset({ apply = '' }) {
  await db?.close().catch(() => {});
  db = await fresh();
  if (apply) await db.exec(apply).catch(() => {});
  return { ok: true };
}

// Values the page can show as they are: text in Postgres' own formats.
const NUMERIC = new Set([20, 21, 23, 26, 700, 701, 1700]);
const TYPE_NAMES = {
  16: 'bool', 17: 'bytea', 18: 'char', 19: 'name', 20: 'int8', 21: 'int2', 23: 'int4', 25: 'text', 26: 'oid',
  114: 'json', 194: 'pg_node_tree', 700: 'float4', 701: 'float8', 1000: '_bool', 1003: '_name', 1005: '_int2',
  1007: '_int4', 1009: '_text', 1015: '_varchar', 1016: '_int8', 1042: 'bpchar', 1043: 'varchar', 1082: 'date',
  1083: 'time', 1114: 'timestamp', 1184: 'timestamptz', 1186: 'interval', 1700: 'numeric', 2205: 'regclass',
  2206: 'regtype', 2249: 'record', 2278: 'void', 2950: 'uuid', 2951: '_uuid', 3802: 'jsonb', 3807: '_jsonb', 705: 'text',
};
const typeName = (oid) => TYPE_NAMES[oid] ?? String(oid);
const pad = (n, width = 2) => String(n).padStart(width, '0');

function cell(value, oid) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return value;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return String(value);
    const date = `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
    if (oid === 1082) return date;
    const time = `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`;
    return oid === 1114 ? `${date} ${time}` : `${date} ${time}+00`;
  }
  if (value instanceof Uint8Array) return `\\x${[...value].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  if (Array.isArray(value)) return `{${value.map((v) => (v === null ? 'NULL' : typeof v === 'object' ? JSON.stringify(v) : String(v))).join(',')}}`;
  return JSON.stringify(value);
}

function errorOf(error) {
  const e = error ?? {};
  const pick = (key) => (typeof e[key] === 'string' && e[key] ? e[key] : undefined);
  return {
    message: typeof e.message === 'string' ? e.message : String(e),
    code: pick('code') ?? '',
    severity: pick('severity') ?? 'ERROR',
    detail: pick('detail'),
    hint: pick('hint'),
    where: pick('where'),
    table: pick('table'),
    column: pick('column'),
    constraint: pick('constraint'),
    position: Number(e.position) || 0,
  };
}

const literal = (text) => `'${String(text).replace(/'/g, "''")}'`;
const ident = (name) => `"${String(name).replace(/"/g, '""')}"`;
