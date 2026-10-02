-- Walldrobe: walls people hung, the public feed.
-- Lives in the in-wharton Supabase project beside In. Every Walldrobe object starts with wd_
-- and touches nothing else. Safe to run again.
--
-- Who is asking: each phone keeps a random secret. Only its sha256 is stored, in wd_owners,
-- which nobody can read. Every write goes through a wd_ function that checks the secret.
-- The browser can only read wd_posts that are not hidden.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.wd_posts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null default '' check (char_length(name) <= 40),
  note text not null default '' check (char_length(note) <= 240),
  room text not null default '' check (char_length(room) <= 60),
  body jsonb not null,
  hidden boolean not null default false
);
create index if not exists wd_posts_recent on public.wd_posts (created_at desc) where not hidden;

create table if not exists public.wd_owners (
  post_id uuid primary key references public.wd_posts (id) on delete cascade,
  owner text not null
);
create index if not exists wd_owners_owner on public.wd_owners (owner);

create table if not exists public.wd_reports (
  post_id uuid not null references public.wd_posts (id) on delete cascade,
  reporter text not null,
  reason text not null default '' check (char_length(reason) <= 120),
  created_at timestamptz not null default now(),
  primary key (post_id, reporter)
);

alter table public.wd_posts enable row level security;
alter table public.wd_owners enable row level security;
alter table public.wd_reports enable row level security;

revoke all on public.wd_posts, public.wd_owners, public.wd_reports from anon, authenticated;
grant select on public.wd_posts to anon, authenticated;

drop policy if exists wd_posts_read on public.wd_posts;
create policy wd_posts_read on public.wd_posts for select to anon, authenticated using (not hidden);

-- Share a wall. Ten a day per phone, 300 an hour across everyone, under 900 KB each.
create or replace function public.wd_share(secret text, p_name text, p_note text, p_room text, p_body jsonb)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare me text; new_id uuid; mine int; everyone int;
begin
  if secret is null or char_length(secret) < 32 or char_length(secret) > 128 then raise exception 'bad secret'; end if;
  if p_body is null or jsonb_typeof(p_body) <> 'object' then raise exception 'bad post'; end if;
  if octet_length(p_body::text) > 900000 then raise exception 'post too big'; end if;
  me := encode(digest(secret, 'sha256'), 'hex');
  select count(*) into mine from wd_owners o join wd_posts p on p.id = o.post_id
    where o.owner = me and p.created_at > now() - interval '1 day';
  if mine >= 10 then raise exception 'too many today'; end if;
  select count(*) into everyone from wd_posts where created_at > now() - interval '1 hour';
  if everyone >= 300 then raise exception 'busy, try later'; end if;
  insert into wd_posts (name, note, room, body)
    values (left(coalesce(p_name, ''), 40), left(coalesce(p_note, ''), 240), left(coalesce(p_room, ''), 60), p_body)
    returning id into new_id;
  insert into wd_owners (post_id, owner) values (new_id, me);
  return new_id;
end $$;

-- Remove your own wall.
create or replace function public.wd_remove(secret text, post uuid)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare me text;
begin
  if secret is null or char_length(secret) < 32 then return false; end if;
  me := encode(digest(secret, 'sha256'), 'hex');
  delete from wd_posts p using wd_owners o where p.id = post and o.post_id = p.id and o.owner = me;
  return found;
end $$;

-- Report a wall. Three reports from different phones hide it until someone looks.
create or replace function public.wd_report(secret text, post uuid, why text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare me text;
begin
  if secret is null or char_length(secret) < 32 then return false; end if;
  me := encode(digest(secret, 'sha256'), 'hex');
  insert into wd_reports (post_id, reporter, reason) values (post, me, left(coalesce(why, ''), 120))
    on conflict do nothing;
  update wd_posts set hidden = true
    where id = post and (select count(*) from wd_reports r where r.post_id = post) >= 3;
  return true;
end $$;

-- Which walls are mine, so the phone can show Remove on them.
create or replace function public.wd_mine(secret text)
returns setof uuid language sql stable security definer set search_path = public, extensions as $$
  select o.post_id from wd_owners o where secret is not null and char_length(secret) >= 32
    and o.owner = encode(digest(secret, 'sha256'), 'hex');
$$;

revoke all on function public.wd_share(text, text, text, text, jsonb), public.wd_remove(text, uuid),
  public.wd_report(text, uuid, text), public.wd_mine(text) from public;
grant execute on function public.wd_share(text, text, text, text, jsonb), public.wd_remove(text, uuid),
  public.wd_report(text, uuid, text), public.wd_mine(text) to anon, authenticated;

notify pgrst, 'reload schema';
