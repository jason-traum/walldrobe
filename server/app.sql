-- Walldrobe accounts: profiles, walls, follows, saves. For Walldrobe's own Supabase project
-- (not in-wharton: sign-ins there are shared with In.). Safe to run again.
--
-- Who is asking: Supabase Auth. Every write is checked against auth.uid() by row level
-- security or by a function that reads it; the browser holds only the publishable key.
-- Wall photos stay private: a wall's room photo is never in a public row. A shared wall shows
-- the drawn wall, and the flattened wall photo only when its owner turns that on.

create extension if not exists citext with schema extensions;

-- ---------- Profiles ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle extensions.citext not null unique check (handle ~ '^[a-z0-9_]{3,24}$'),
  name text not null default '' check (char_length(name) <= 40),
  bio text not null default '' check (char_length(bio) <= 160),
  avatar_url text check (avatar_url is null or (char_length(avatar_url) <= 400 and avatar_url ~ '^https://')),
  created_at timestamptz not null default now()
);

-- A profile for every new sign-in: the handle from the email or Google name, made unique.
create or replace function public.new_profile() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare base text; h text; n int := 0; nm text;
begin
  nm := left(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''), 40);
  base := lower(regexp_replace(coalesce(nullif(nm, ''), split_part(coalesce(new.email, ''), '@', 1), 'wall'), '[^a-zA-Z0-9]+', '', 'g'));
  base := left(case when char_length(base) < 3 then base || 'wall' else base end, 20);
  h := base;
  while exists (select 1 from profiles where handle = h) loop n := n + 1; h := left(base, 20) || n; end loop;
  insert into profiles (id, handle, name, avatar_url)
    values (new.id, h, nm, case when new.raw_user_meta_data->>'avatar_url' ~ '^https://' then left(new.raw_user_meta_data->>'avatar_url', 400) end);
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.new_profile();

-- ---------- Walls ----------
-- A wall you saved. body is the wall as the app keeps it (size, what's in the way, the layout,
-- your pieces as sizes and small thumbnails), never the room photo. photo is the flattened
-- wall, only sent when show_photo is on.
create table if not exists public.walls (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  client_id text not null check (char_length(client_id) <= 64),
  name text not null default '' check (char_length(name) <= 60),
  room text not null default '' check (char_length(room) <= 60),
  note text not null default '' check (char_length(note) <= 240),
  body jsonb not null check (jsonb_typeof(body) = 'object' and octet_length(body::text) <= 400000),
  photo text check (photo is null or octet_length(photo) <= 600000),
  is_public boolean not null default false,
  show_photo boolean not null default false,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  shared_at timestamptz,
  unique (owner, client_id)
);
create index if not exists walls_feed on public.walls (shared_at desc) where is_public and not hidden;
create index if not exists walls_owner on public.walls (owner, updated_at desc);

-- A wall's photo is shown only when its owner turned it on; otherwise it isn't stored at all.
create or replace function public.walls_touch() returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if not new.show_photo then new.photo := null; end if;
  if new.is_public and (tg_op = 'INSERT' or not old.is_public) then new.shared_at := now(); end if;
  if not new.is_public then new.shared_at := null; end if;
  return new;
end $$;
drop trigger if exists walls_touch on public.walls;
create trigger walls_touch before insert or update on public.walls for each row execute function public.walls_touch();

-- ---------- Follows and saves ----------
create table if not exists public.follows (
  follower uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  followee uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower, followee),
  check (follower <> followee)
);
create index if not exists follows_followee on public.follows (followee);

create table if not exists public.wall_saves (
  user_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  wall_id uuid not null references public.walls (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, wall_id)
);
create index if not exists wall_saves_wall on public.wall_saves (wall_id);

create table if not exists public.reports (
  wall_id uuid not null references public.walls (id) on delete cascade,
  reporter uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  reason text not null default '' check (char_length(reason) <= 120),
  created_at timestamptz not null default now(),
  primary key (wall_id, reporter)
);
-- Three reports hide a wall until someone looks.
create or replace function public.reports_hide() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update walls set hidden = true where id = new.wall_id and (select count(*) from reports r where r.wall_id = new.wall_id) >= 3;
  return new;
end $$;
drop trigger if exists reports_hide on public.reports;
create trigger reports_hide after insert on public.reports for each row execute function public.reports_hide();

-- ---------- Who can do what ----------
alter table public.profiles enable row level security;
alter table public.walls enable row level security;
alter table public.follows enable row level security;
alter table public.wall_saves enable row level security;
alter table public.reports enable row level security;

revoke all on public.profiles, public.walls, public.follows, public.wall_saves, public.reports from anon, authenticated;
grant select on public.profiles, public.follows to anon, authenticated;
grant select (id, owner, client_id, name, room, note, body, photo, is_public, show_photo, hidden, created_at, updated_at, shared_at) on public.walls to anon, authenticated;
grant update (handle, name, bio, avatar_url) on public.profiles to authenticated;
grant insert (client_id, name, room, note, body, photo, is_public, show_photo) on public.walls to authenticated;
grant update (name, room, note, body, photo, is_public, show_photo) on public.walls to authenticated;
grant delete on public.walls to authenticated;
grant insert (followee) on public.follows to authenticated;
grant delete on public.follows to authenticated;
grant select on public.wall_saves to authenticated;
grant insert (wall_id) on public.wall_saves to authenticated;
grant delete on public.wall_saves to authenticated;
grant insert (wall_id, reason) on public.reports to authenticated;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to anon, authenticated using (true);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists walls_read on public.walls;
create policy walls_read on public.walls for select to anon, authenticated
  using ((is_public and not hidden) or owner = (select auth.uid()));
drop policy if exists walls_insert on public.walls;
create policy walls_insert on public.walls for insert to authenticated with check (owner = (select auth.uid()));
drop policy if exists walls_update on public.walls;
create policy walls_update on public.walls for update to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
drop policy if exists walls_delete on public.walls;
create policy walls_delete on public.walls for delete to authenticated using (owner = (select auth.uid()));

drop policy if exists follows_read on public.follows;
create policy follows_read on public.follows for select to anon, authenticated using (true);
drop policy if exists follows_insert on public.follows;
create policy follows_insert on public.follows for insert to authenticated with check (follower = (select auth.uid()));
drop policy if exists follows_delete on public.follows;
create policy follows_delete on public.follows for delete to authenticated using (follower = (select auth.uid()));

drop policy if exists saves_read on public.wall_saves;
create policy saves_read on public.wall_saves for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists saves_insert on public.wall_saves;
create policy saves_insert on public.wall_saves for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from walls w where w.id = wall_id and w.is_public and not w.hidden));
drop policy if exists saves_delete on public.wall_saves;
create policy saves_delete on public.wall_saves for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert to authenticated with check (reporter = (select auth.uid()));

-- How many saved a public wall, without showing who.
create or replace function public.save_counts(ids uuid[]) returns table (wall_id uuid, n bigint)
language sql stable security definer set search_path = public as $$
  select s.wall_id, count(*) from wall_saves s join walls w on w.id = s.wall_id
  where s.wall_id = any (ids[1:100]) and w.is_public and not w.hidden group by s.wall_id;
$$;
revoke all on function public.save_counts(uuid[]) from public;
grant execute on function public.save_counts(uuid[]) to anon, authenticated;
revoke all on function public.new_profile(), public.walls_touch(), public.reports_hide() from public, anon, authenticated;

notify pgrst, 'reload schema';
