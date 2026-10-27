import { readFile } from 'node:fs/promises';
import { database, transaction, closeDatabase } from '../lib/postgres.mjs';

if (!process.argv.includes('--apply')) {
  console.log('Dry run only. Re-run with --apply to initialize the empty Family Tutor database for Izan (Grade 8) and Zeidin (Grade 1).');
  process.exit(0);
}

const sql = await readFile(new URL('../db/001_family_tutor.sql', import.meta.url), 'utf8');
const learning = await readFile(new URL('../db/003_family_learning.sql', import.meta.url), 'utf8');
const compatibility = `
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text not null unique);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.user_id', true),'')::uuid $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
`;
const clean = text => text
  .replace(/begin;|commit;/gi, '')
  .replace(/insert into storage\.buckets[\s\S]*?on conflict\(id\) do nothing;/gi, '')
  .replace(/create policy family_material_object_[\s\S]*?\);/gi, '');

await transaction(async client => {
  const exists = await client.query("select to_regclass('public.students') as students, to_regclass('private.app_sessions') as sessions");
  if (!exists.rows[0].students) {
    await client.query(compatibility);
    await client.query(clean(sql));
    await client.query(clean(learning));
    await client.query(`create table private.auth_identities (provider_id text primary key, user_id uuid not null references public.profiles(id) on delete cascade, email text not null);
      create table private.app_sessions (token_hash text primary key, user_id uuid not null references public.profiles(id) on delete cascade, expires_at timestamptz not null);
      create index app_sessions_expiry on private.app_sessions(expires_at);`);
  }
  await client.query(`insert into public.students(id,display_name,grade,attention_span_minutes) values
    ('izan','Izan','Grade 8',25),('zeidin','Zeidin','Grade 1',20)
    on conflict (id) do update set display_name=excluded.display_name,grade=excluded.grade`);
});
console.log('Family Tutor schema initialized and the two reviewed student records are present.');
await closeDatabase();
