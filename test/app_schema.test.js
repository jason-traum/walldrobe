// Walldrobe's accounts database (server/app.sql), checked in a real Postgres run in-process
// (PGlite), with a stand-in for Supabase's auth: who can read and write what.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

test('accounts: profiles on sign-in, private and shared walls, follows, saves and reports', async () => {
  const db = new PGlite({ extensions: { citext, pgcrypto } });
  await db.exec(`
create schema auth; create schema extensions;
create role anon; create role authenticated;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.uid', true), '')::uuid $$;
grant usage on schema auth, public, extensions to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
`);
  await db.exec(readFileSync(new URL('../server/app.sql', import.meta.url), 'utf8').replace(/notify pgrst.*$/m, ''));
  const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222';
  await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('${A}', 'jason@example.com', '{"full_name":"Jason Traum","avatar_url":"https://x.test/a.png"}'), ('${B}', 'kelly@example.com', '{}');`);
  const as = async (uid, role, q) => { await db.exec(`set role ${role}; select set_config('request.uid', '${uid || ''}', false);`); try { return await db.query(q); } finally { await db.exec('reset role;'); } };
  const ok = (name, cond, d = '') => assert.ok(cond, `${name} ${d}`);
  const profs = (await db.query('select id, handle, name, avatar_url from profiles order by handle')).rows;
  ok('a profile per sign-in, with a handle', profs.length === 2 && profs.some((p) => p.handle === 'jasontraum') && profs.some((p) => p.handle === 'kelly'), JSON.stringify(profs));
  // A writes a private wall and a public one.
  await as(A, 'authenticated', `insert into walls (client_id, name, body, photo, is_public, show_photo) values ('w1', 'Private', '{"v":1}', 'data:x', false, false), ('w2', 'Shared', '{"v":1}', 'data:photo', true, true)`);
  const w = (await db.query('select client_id, owner, photo, shared_at from walls order by client_id')).rows;
  ok('owner set from who is signed in, photo dropped when not shown', w[0].owner === A && w[0].photo === null && w[1].photo === 'data:photo' && w[1].shared_at && !w[0].shared_at);
  ok('anyone reads only shared walls', (await as(null, 'anon', 'select name from walls')).rows.map((r) => r.name).join() === 'Shared');
  ok('the owner reads both', (await as(A, 'authenticated', 'select name from walls')).rows.length === 2);
  ok('someone else reads only the shared one', (await as(B, 'authenticated', 'select name from walls')).rows.length === 1);
  let threw = false;
  try { await as(B, 'authenticated', `update walls set name = 'mine now' where client_id = 'w2'`); } catch { threw = true; }
  const name2 = (await db.query(`select name from walls where client_id='w2'`)).rows[0].name;
  ok('nobody else can change a wall', name2 === 'Shared', threw ? 'refused' : 'no rows');
  threw = false; try { await as(B, 'authenticated', `insert into walls (owner, client_id, body) values ('${A}', 'x', '{}')`); } catch { threw = true; }
  ok('nobody can write a wall as someone else', threw);
  threw = false; try { await as(null, 'anon', `insert into walls (client_id, body) values ('x', '{}')`); } catch { threw = true; }
  ok('signed out can write nothing', threw);
  threw = false; try { await as(B, 'authenticated', `update profiles set name = 'hacked' where id = '${A}'`); } catch { threw = true; }
  ok('nobody else can change a profile', (await db.query(`select name from profiles where id='${A}'`)).rows[0].name === 'Jason Traum');
  threw = false; try { await as(A, 'authenticated', `update profiles set handle = 'Bad Name!' where id = '${A}'`); } catch { threw = true; }
  ok('handles are checked', threw);
  // Follows and saves.
  await as(B, 'authenticated', `insert into follows (followee) values ('${A}')`);
  ok('follow as yourself', (await db.query('select follower from follows')).rows[0].follower === B);
  threw = false; try { await as(B, 'authenticated', `insert into follows (follower, followee) values ('${A}', '${B}')`); } catch { threw = true; }
  ok('nobody can follow for someone else', threw);
  const shared = (await db.query(`select id from walls where client_id='w2'`)).rows[0].id, priv = (await db.query(`select id from walls where client_id='w1'`)).rows[0].id;
  await as(B, 'authenticated', `insert into wall_saves (wall_id) values ('${shared}')`);
  threw = false; try { await as(B, 'authenticated', `insert into wall_saves (wall_id) values ('${priv}')`); } catch { threw = true; }
  ok('save a shared wall, never a private one', threw);
  ok('save counts without who', (await as(null, 'anon', `select * from save_counts(array['${shared}'::uuid])`)).rows[0].n == 1);
  ok('your saves are yours only', (await as(A, 'authenticated', 'select * from wall_saves')).rows.length === 0);
  // Unsharing clears the photo and the date.
  await as(A, 'authenticated', `update walls set is_public = false, show_photo = false where client_id = 'w2'`);
  const w2 = (await db.query(`select photo, shared_at from walls where client_id='w2'`)).rows[0];
  ok('taking it off clears the photo', w2.photo === null && w2.shared_at === null);
  // Reports: three hide it.
  await as(A, 'authenticated', `update walls set is_public = true where client_id = 'w2'`);
  await db.exec(`insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333','c@x.com'), ('44444444-4444-4444-4444-444444444444','d@x.com')`);
  for (const u of [B, '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444']) await as(u, 'authenticated', `insert into reports (wall_id) values ('${shared}')`);
  ok('three reports hide a wall', (await as(null, 'anon', 'select count(*)::int n from walls')).rows[0].n === 0);
  threw = false; try { await as(A, 'authenticated', `insert into walls (client_id, body) values ('big', '{"x":"${'a'.repeat(410000)}"}')`); } catch { threw = true; }
  ok('a wall over 400 KB is refused', threw);
  await db.close();
});
