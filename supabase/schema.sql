-- Pixelia Pokemon Server pre-registration schema
-- Run the whole file once in Supabase Dashboard > SQL Editor.
-- Safe to re-run (uses IF NOT EXISTS / OR REPLACE).

-- ============================================================
-- 1. Tables
-- ============================================================
create table if not exists public.preregistrations (
  id               bigint generated always as identity primary key,
  user_id          uuid unique default auth.uid(),
  nickname         text not null,
  nickname_key     text generated always as (lower(nickname)) stored unique,
  source           text not null,
  source_etc       text,
  referrer         text,
  via_ref          boolean not null default false,
  created_at       timestamptz not null default now(),
  is_void          boolean not null default false,
  reward_given     boolean not null default false,
  top_reward_given boolean not null default false,

  constraint nickname_format check (
    nickname ~ '^[A-Za-z0-9_ ]{3,16}$' and nickname = btrim(nickname) and position('  ' in nickname) = 0
  ),
  constraint source_valid check (source in ('youtube', 'tiktok', 'discord', 'friend', 'etc')),
  constraint source_etc_valid check (
    (source = 'etc' and source_etc is not null and char_length(btrim(source_etc)) between 1 and 50)
    or (source <> 'etc' and source_etc is null)
  ),
  constraint referrer_format check (
    referrer is null or (
      referrer ~ '^[A-Za-z0-9_ ]{3,16}$' and referrer = btrim(referrer) and position('  ' in referrer) = 0
    )
  ),
  constraint no_self_referral check (referrer is null or lower(referrer) <> lower(nickname)),
  constraint via_ref_needs_referrer check (not via_ref or referrer is not null)
);

create index if not exists preregistrations_referrer_idx on public.preregistrations (lower(referrer));

-- Admin list (no policies = nobody can read it through the API)
create table if not exists public.admins (
  user_id uuid primary key,
  note    text
);

-- ============================================================
-- 2. Helper
-- ============================================================
create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ============================================================
-- 3. Privileges (column level) + RLS
-- ============================================================
alter table public.preregistrations enable row level security;
alter table public.admins enable row level security;

revoke all on public.preregistrations from anon, authenticated;
revoke all on public.admins from anon, authenticated;

-- Visitors (anonymous sign-in = authenticated role) may only insert these columns.
-- id, user_id, created_at, is_void, reward flags always come from defaults.
grant insert (nickname, source, source_etc, referrer, via_ref) on public.preregistrations to authenticated;
-- Admin operations (row access is still limited by the policies below)
grant select, delete on public.preregistrations to authenticated;
grant update (is_void, reward_given, top_reward_given) on public.preregistrations to authenticated;

drop policy if exists prereg_insert_self on public.preregistrations;
create policy prereg_insert_self on public.preregistrations
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists prereg_admin_select on public.preregistrations;
create policy prereg_admin_select on public.preregistrations
  for select to authenticated
  using (public.is_admin());

drop policy if exists prereg_admin_update on public.preregistrations;
create policy prereg_admin_update on public.preregistrations
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists prereg_admin_delete on public.preregistrations;
create policy prereg_admin_delete on public.preregistrations
  for delete to authenticated
  using (public.is_admin());

-- ============================================================
-- 4. Public RPC (no personal data)
-- ============================================================

-- Total valid pre-registrations
create or replace function public.get_public_stats()
returns json
language sql stable security definer
set search_path = public
as $$
  select json_build_object('total', count(*)::int)
  from public.preregistrations
  where not is_void;
$$;

-- Promoter TOP 10. Counts valid referrals whose referrer also has a valid pre-registration.
create or replace function public.get_promoter_ranking()
returns table (nickname text, referrals int)
language sql stable security definer
set search_path = public
as $$
  select p.nickname, count(r.id)::int as referrals
  from public.preregistrations r
  join public.preregistrations p
    on p.nickname_key = lower(r.referrer) and not p.is_void
  where not r.is_void and r.referrer is not null
  group by p.id, p.nickname
  order by count(r.id) desc, p.id asc
  limit 10;
$$;

-- The caller's own pre-registration and its order number
create or replace function public.my_position()
returns json
language sql stable security definer
set search_path = public
as $$
  select json_build_object(
    'nickname', me.nickname,
    'position', (select count(*)::int from public.preregistrations x where x.id <= me.id and not x.is_void)
  )
  from public.preregistrations me
  where me.user_id = auth.uid() and auth.uid() is not null
  limit 1;
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.get_public_stats() from public;
revoke all on function public.get_promoter_ranking() from public;
revoke all on function public.my_position() from public;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.get_public_stats() to anon, authenticated;
grant execute on function public.get_promoter_ranking() to anon, authenticated;
grant execute on function public.my_position() to authenticated;

-- ============================================================
-- 5. Register an admin (run separately after creating the user)
--    Replace the email, then run only this statement.
-- ============================================================
-- insert into public.admins (user_id, note)
-- select id, email from auth.users where email = 'admin@example.com'
-- on conflict do nothing;
