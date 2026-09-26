// The sample app inside the playground: a tiny multi-tenant SaaS with row-level
// security. Plain data, no DOM: the database worker seeds it, the dashboard
// draws it, and the Stand-in's prompt describes the same schema and policies.

export const PGLITE = 'https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.5.8/dist/';

// Who "Run as" can be. Signed-in users share the authenticated role; the JWT
// claims tell them apart, and auth.uid() reads the sub claim.
export const USERS = [
  { id: 'anon', label: 'anon', detail: 'Not signed in', role: 'anon', claims: { role: 'anon' } },
  {
    id: 'ada', label: 'Ada', name: 'Ada Moreau', detail: 'Member · Acme', org: 1, role: 'authenticated',
    claims: { sub: 'a0000000-0000-4000-8000-00000000000a', role: 'authenticated', email: 'ada@acme.test' },
  },
  {
    id: 'bo', label: 'Bo', name: 'Bo Lindqvist', detail: 'Admin · Acme', org: 1, role: 'authenticated',
    claims: { sub: 'b0000000-0000-4000-8000-00000000000b', role: 'authenticated', email: 'bo@acme.test' },
  },
  {
    id: 'cy', label: 'Cy', name: 'Cy Okafor', detail: 'Member · Globex', org: 2, role: 'authenticated',
    claims: { sub: 'c0000000-0000-4000-8000-00000000000c', role: 'authenticated', email: 'cy@globex.test' },
  },
  { id: 'service_role', label: 'service_role', detail: 'Bypasses RLS', role: 'service_role', claims: { role: 'service_role' } },
];

export const userById = (id) => USERS.find((u) => u.id === id) ?? USERS[3];

export const TABLES = [
  { name: 'organizations', columns: [['id', 'int4'], ['name', 'text'], ['plan', 'text']] },
  { name: 'profiles', columns: [['id', 'uuid'], ['full_name', 'text'], ['title', 'text']] },
  { name: 'members', columns: [['org_id', 'int4'], ['user_id', 'uuid'], ['role', 'text']] },
  { name: 'projects', columns: [['id', 'int4'], ['org_id', 'int4'], ['name', 'text'], ['status', 'text']] },
  {
    name: 'invoices',
    columns: [['id', 'int4'], ['org_id', 'int4'], ['project_id', 'int4'], ['number', 'text'], ['amount_cents', 'int4'], ['status', 'text'], ['due_on', 'date']],
  },
];

// The seeded policies. Switching one off drops it; switching it on runs this again.
export const POLICIES = [
  { name: 'members read their orgs', table: 'organizations', command: 'SELECT', using: 'is_member(id)' },
  { name: 'members read teammates', table: 'members', command: 'SELECT', using: 'is_member(org_id)' },
  {
    name: 'teammates read profiles', table: 'profiles', command: 'SELECT',
    using: 'id = auth.uid() or exists (\n    select 1 from members m\n    where m.user_id = profiles.id and is_member(m.org_id)\n  )',
  },
  { name: 'users update own profile', table: 'profiles', command: 'UPDATE', using: 'id = auth.uid()', check: 'id = auth.uid()' },
  { name: 'members read org projects', table: 'projects', command: 'SELECT', using: 'is_member(org_id)' },
  { name: 'members create projects', table: 'projects', command: 'INSERT', check: 'is_member(org_id)' },
  { name: 'admins read invoices', table: 'invoices', command: 'SELECT', using: 'is_admin(org_id)' },
  { name: 'admins create invoices', table: 'invoices', command: 'INSERT', check: 'is_admin(org_id)' },
];

export function policySql({ name, table, command, roles = ['authenticated'], using, check }) {
  return [
    `create policy "${name.replace(/"/g, '""')}"`,
    `on ${table} for ${command.toLowerCase()}`,
    `to ${roles.join(', ')}`,
    ...(using ? [`using (${using})`] : []),
    ...(check ? [`with check (${check})`] : []),
  ].join('\n') + ';';
}

// Saved snippets. `as` is the user each story is told with.
export const SNIPPETS = [
  {
    id: 'whoami', title: 'Who am I?', as: 'ada',
    sql: `-- Who does Postgres think you are? Change "Run as" and run it again.
select current_user,
       auth.uid(),
       auth.jwt() ->> 'email' as email;`,
  },
  {
    id: 'projects', title: 'My projects', as: 'ada',
    sql: `-- Projects are shared with everyone in the same organization.
select p.id, p.name, p.status, o.name as org
from projects p
join organizations o on o.id = p.org_id
order by p.id;`,
  },
  {
    id: 'invoices', title: 'All invoices', as: 'ada',
    sql: `-- Only admins can read invoices. Try Ada, then Bo.
select number, amount_cents, status, due_on
from invoices
order by due_on;`,
  },
  {
    id: 'billed', title: 'Billed per project', as: 'ada',
    sql: `-- Projects joined to their invoices. What does Ada see?
select p.name as project,
       count(i.id) as invoices,
       coalesce(sum(i.amount_cents), 0) / 100 as billed_usd
from projects p
left join invoices i on i.project_id = p.id
group by p.id
order by p.id;`,
  },
  {
    id: 'log-invoice', title: 'Log an invoice', as: 'cy',
    sql: `-- Cy is a member of Globex. Can Cy log a new invoice?
insert into invoices (org_id, project_id, number, amount_cents, due_on)
values (2, 4, 'GX-2003', 480000, '2026-10-31');`,
  },
  {
    id: 'rename', title: 'Rename a teammate', as: 'ada',
    sql: `-- Ada tries to rename Bo. No error, but check the row count.
update profiles
set full_name = 'Bo the Brave'
where full_name = 'Bo Lindqvist'
returning *;`,
  },
  {
    id: 'delete-invoice', title: 'Delete an invoice', as: 'bo',
    sql: `-- Bo is an admin. Can Bo delete a draft invoice?
delete from invoices
where number = 'ACM-1004';`,
  },
  {
    id: 'policies', title: 'Policies on invoices', as: 'ada',
    sql: `-- Policies are rows in a catalog, and you can query them.
select policyname, cmd, qual, with_check
from pg_policies
where tablename = 'invoices';`,
  },
];

export const HERO_SNIPPET = 'log-invoice';

// Runs once as the database owner in a fresh Postgres.
export const SEED_SQL = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin bypassrls;
grant postgres to service_role; -- In this sandbox, service_role may change the schema too.

create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

create table organizations (
  id int primary key,
  name text not null,
  plan text not null default 'free'
);
create table profiles (
  id uuid primary key,
  full_name text not null,
  title text
);
create table members (
  org_id int not null references organizations,
  user_id uuid not null references profiles,
  role text not null check (role in ('admin', 'member')),
  primary key (org_id, user_id)
);
create table projects (
  id int generated by default as identity primary key,
  org_id int not null references organizations,
  name text not null,
  status text not null default 'active'
);
create table invoices (
  id int generated by default as identity primary key,
  org_id int not null references organizations,
  project_id int references projects,
  number text not null unique,
  amount_cents int not null check (amount_cents > 0),
  status text not null default 'draft' check (status in ('draft', 'sent', 'paid')),
  due_on date
);

-- Security definer: they read members without tripping members' own policy.
create function is_member(org int) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where org_id = org and user_id = auth.uid())
$$;
create function is_admin(org int) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where org_id = org and user_id = auth.uid() and role = 'admin')
$$;

insert into organizations values (1, 'Acme', 'pro'), (2, 'Globex', 'free');
insert into profiles values
  ('a0000000-0000-4000-8000-00000000000a', 'Ada Moreau', 'Product designer'),
  ('b0000000-0000-4000-8000-00000000000b', 'Bo Lindqvist', 'Founder'),
  ('c0000000-0000-4000-8000-00000000000c', 'Cy Okafor', 'Engineer'),
  ('d0000000-0000-4000-8000-00000000000d', 'Dee Tanaka', 'Head of operations');
insert into members values
  (1, 'a0000000-0000-4000-8000-00000000000a', 'member'),
  (1, 'b0000000-0000-4000-8000-00000000000b', 'admin'),
  (2, 'c0000000-0000-4000-8000-00000000000c', 'member'),
  (2, 'd0000000-0000-4000-8000-00000000000d', 'admin');
insert into projects (org_id, name, status) values
  (1, 'Website relaunch', 'active'), (1, 'Mobile app', 'active'), (1, 'Brand refresh', 'done'),
  (2, 'Data warehouse', 'active'), (2, 'Partner portal', 'paused');
insert into invoices (org_id, project_id, number, amount_cents, status, due_on) values
  (1, 1, 'ACM-1001', 1250000, 'paid', '2026-08-15'),
  (1, 3, 'ACM-1002', 320000, 'paid', '2026-09-01'),
  (1, 2, 'ACM-1003', 840000, 'sent', '2026-10-10'),
  (1, 2, 'ACM-1004', 600000, 'draft', '2026-11-01'),
  (2, 4, 'GX-2001', 2100000, 'sent', '2026-09-30'),
  (2, 5, 'GX-2002', 480000, 'paid', '2026-08-20');

grant usage on schema public, auth to anon, authenticated, service_role;
grant select on all tables in schema public to anon, authenticated;
grant insert, update on profiles, projects, invoices to authenticated;
grant delete on projects to authenticated;
grant all on all tables in schema public to service_role;

alter table organizations enable row level security;
alter table profiles enable row level security;
alter table members enable row level security;
alter table projects enable row level security;
alter table invoices enable row level security;

${POLICIES.map((p) => policySql(p)).join('\n')}
`;
