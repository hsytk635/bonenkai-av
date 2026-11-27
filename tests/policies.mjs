import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '../node_modules/.qa/node_modules/@electric-sql/pglite/dist/index.js'

const db=new PGlite()
const admin='00000000-0000-4000-8000-000000000001'
const editor='00000000-0000-4000-8000-000000000002'
const viewer='00000000-0000-4000-8000-000000000003'
const item='00000000-0000-4000-8000-000000000004'
const dir=editor+'/'+item
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;
    create table storage.buckets(id text primary key,name text,public bool,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant usage on schema auth,storage to authenticated,anon;
    grant select,insert,delete on storage.objects to authenticated,anon;
    create publication supabase_realtime;
  `)
  await db.exec(await readFile(new URL('../supabase/migrations/202611270001_av.sql',import.meta.url),'utf8'))
  await db.exec(await readFile(new URL('../supabase/migrations/202611270002_shared_access.sql',import.meta.url),'utf8'))
  await db.exec(await readFile(new URL('../supabase/migrations/202611270003_m4a.sql',import.meta.url),'utf8'))
  assert.ok((await db.query("select allowed_mime_types from storage.buckets where id='av-media'")).rows[0].allowed_mime_types.includes('audio/mp4'))
  await db.exec(`
    insert into auth.users values ('${admin}'),('${editor}'),('${viewer}');
    insert into public.profiles(user_id,display_name,role) values ('${admin}','admin','admin'),('${editor}','editor','editor'),('${viewer}','viewer','viewer');
  `)
  const assume=(role,id='')=>db.exec(`reset role; set test.uid='${id}'; set role ${role}`)
  const count=async table=>Number((await db.query('select count(*) from '+table)).rows[0].count)
  await assume('anon')
  await assert.rejects(db.query('select * from public.media'))
  assert.equal(await count('storage.objects'),0)
  await assume('authenticated',editor)
  await db.exec(`insert into storage.objects values ('av-media','${dir}/original.m4a'); insert into public.media(id,title,media_type,storage_path,file_name,mime_type,file_size,checksum) values ('${item}','Bell','effect','${dir}/original.m4a','Bell.m4a','audio/mp4',1024,repeat('a',64));`)
  await assert.rejects(db.query("select public.manage_member($1,'viewer')",[admin]))
  assert.equal((await db.query('delete from storage.objects returning name')).rows.length,0)
  await db.exec("update public.media set title='Desk bell'")
  await assume('authenticated',viewer)
  assert.equal(await count('public.media'),1)
  assert.equal(await count('storage.objects'),1)
  assert.equal((await db.query("update public.media set title='blocked' returning title")).rows.length,0)
  assert.equal((await db.query('delete from public.media returning id')).rows.length,0)
  await assert.rejects(db.query("insert into storage.objects values ('av-media','invalid')"))
  await assume('authenticated',admin)
  await db.query("select public.manage_member($1,'editor')",[viewer])
  await assert.rejects(db.query("select public.manage_member($1,'viewer')",[admin]))
  await db.query('select public.manage_member($1,null)',[viewer])
  await assume('authenticated',viewer)
  assert.equal(await count('public.media'),0)
  assert.equal(await count('storage.objects'),0)
  await assume('authenticated',editor)
  await db.exec('delete from public.media')
  assert.equal((await db.query('delete from storage.objects returning name')).rows.length,1)
  console.log('Migration and role / Storage policies passed in local PostgreSQL (mock Supabase schemas)')
} finally {await db.close()}
