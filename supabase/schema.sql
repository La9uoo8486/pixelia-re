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
-- 5. One pre-registration per IP
--    The raw IP is never stored: only HMAC-SHA256(ip, secret salt).
--    IPv6 is grouped by /64 (one household / one phone line).
--    Rows added from the Supabase dashboard / SQL Editor are not limited.
--    A visitor insert whose IP cannot be read is rejected (IP_UNKNOWN).
--    Delete a row -> its IP is freed. Void a row -> the IP stays used.
--    Turn off:  update public.app_config set value = 'off' where name = 'ip_limit';
-- ============================================================
create extension if not exists pgcrypto with schema extensions;

-- Private settings (no policies = not reachable through the API)
create table if not exists public.app_config (
  name  text primary key,
  value text not null
);
alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;

insert into public.app_config (name, value)
values ('ip_salt', encode(extensions.gen_random_bytes(32), 'hex')),
       ('ip_limit', 'on')
on conflict (name) do nothing;

-- Used IP hashes (no policies = not reachable through the API)
create table if not exists public.prereg_ip_locks (
  ip_hash    text primary key,
  prereg_id  bigint not null unique references public.preregistrations (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.prereg_ip_locks enable row level security;
revoke all on public.prereg_ip_locks from anon, authenticated;

-- Caller IP from the API gateway headers (null when not called through the API)
create or replace function public.request_ip()
returns inet
language plpgsql stable
set search_path = public
as $$
declare
  h json;
  v text;
begin
  h := nullif(current_setting('request.headers', true), '')::json;
  if h is null then
    return null;
  end if;
  -- cf-connecting-ip is set by Cloudflare in front of Supabase (a client cannot override it).
  -- Fallback: the LAST x-forwarded-for entry, which the proxy appends. The first entry
  -- (and x-real-ip) can be sent by the client, so they are never used.
  v := coalesce(
    nullif(btrim(h ->> 'cf-connecting-ip'), ''),
    nullif(btrim(regexp_replace(coalesce(h ->> 'x-forwarded-for', ''), '^.*,', '')), '')
  );
  if v is null then
    return null;
  end if;
  return v::inet;
exception when others then
  return null;
end;
$$;

create or replace function public.prereg_ip_guard()
returns trigger
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  ip   inet;
  k    text;
  salt text;
begin
  if coalesce((select value from public.app_config where name = 'ip_limit'), 'on') <> 'on' then
    return null;
  end if;

  -- Dashboard / SQL inserts (no API user) are not limited
  if auth.uid() is null then
    return null;
  end if;

  -- API insert without a readable IP -> reject (fail closed, never skip the check)
  ip := public.request_ip();
  if ip is null then
    raise exception 'IP_UNKNOWN' using errcode = 'P0001';
  end if;

  k := case when family(ip) = 6 then network(set_masklen(ip, 64))::text else host(ip) end;
  select value into salt from public.app_config where name = 'ip_salt';
  k := encode(extensions.hmac(k, coalesce(salt, ''), 'sha256'), 'hex');

  insert into public.prereg_ip_locks (ip_hash, prereg_id)
  values (k, new.id)
  on conflict (ip_hash) do nothing;

  if not found then
    raise exception 'IP_ALREADY_REGISTERED' using errcode = 'P0001';
  end if;
  return null;
end;
$$;

drop trigger if exists prereg_ip_guard on public.preregistrations;
create trigger prereg_ip_guard
  after insert on public.preregistrations
  for each row execute function public.prereg_ip_guard();

revoke all on function public.request_ip() from public;
revoke all on function public.prereg_ip_guard() from public;

-- ============================================================
-- 7. Abuse guard (needs section 5 first: uses app_config)
--    a) Site-wide speed limit: more than N sign-ups in 1 minute -> rejected (RATE_LIMITED).
--    b) Auto flag (row is kept, nothing is deleted):
--       'ref_burst' = one referrer got N+ referrals within M minutes (the whole burst is flagged)
--       'bot_nick'  = WordWord1234 style nickname (e.g. NeonFox0420)
--    Flagged referrals do NOT count in the public promoter ranking until an admin
--    approves them (flag = 'ok') on admin.html. The total count is unchanged.
--    Rows added from the Supabase dashboard are not checked.
--    Change limits:  update public.app_config set value = '30' where name = 'rate_per_min';
-- ============================================================
alter table public.preregistrations add column if not exists flag text;
grant update (flag) on public.preregistrations to authenticated;  -- admins only (policy above)

create index if not exists preregistrations_created_idx on public.preregistrations (created_at);

insert into public.app_config (name, value)
values ('rate_per_min', '20'),
       ('ref_burst_n', '5'),
       ('ref_burst_min', '10')
on conflict (name) do nothing;

create or replace function public.cfg_int(k text, d int)
returns int
language sql stable security definer
set search_path = public
as $$
  -- Only plain numbers are read (never echoes other settings such as ip_salt in an error)
  select coalesce((select value::int from public.app_config
                   where name = k and value ~ '^[0-9]{1,6}$'), d);
$$;

create or replace function public.prereg_abuse_guard()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  per_min   int := public.cfg_int('rate_per_min', 20);
  burst_n   int := public.cfg_int('ref_burst_n', 5);
  burst_min int := public.cfg_int('ref_burst_min', 10);
  flags     text[] := '{}';
  n         int;
begin
  -- Visitors can never set flag themselves
  new.flag := null;

  -- Dashboard / SQL inserts (no API user) are trusted
  if auth.uid() is null then
    return new;
  end if;

  -- a) site-wide speed limit
  if per_min > 0 then
    select count(*) into n from public.preregistrations
    where created_at > now() - interval '1 minute';
    if n >= per_min then
      raise exception 'RATE_LIMITED' using errcode = 'P0001';
    end if;
  end if;

  -- b1) referral burst
  if new.referrer is not null and burst_n > 0 then
    select count(*) into n from public.preregistrations
    where lower(referrer) = lower(new.referrer)
      and created_at > now() - make_interval(mins => burst_min);
    if n + 1 >= burst_n then
      flags := array_append(flags, 'ref_burst');
      update public.preregistrations
      set flag = 'ref_burst'
      where lower(referrer) = lower(new.referrer)
        and created_at > now() - make_interval(mins => burst_min)
        and flag is null;
    end if;
  end if;

  -- b2) generated nickname pattern
  if new.nickname ~ '^[A-Z][a-z]{2,}[A-Z][a-z]{2,}[0-9]{4}$' then
    flags := array_append(flags, 'bot_nick');
  end if;

  if cardinality(flags) > 0 then
    new.flag := array_to_string(flags, ',');
  end if;
  return new;
end;
$$;

drop trigger if exists prereg_abuse_guard on public.preregistrations;
create trigger prereg_abuse_guard
  before insert on public.preregistrations
  for each row execute function public.prereg_abuse_guard();

revoke all on function public.cfg_int(text, int) from public;
revoke all on function public.prereg_abuse_guard() from public;

-- Public ranking: count only clean or approved referrals
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
    and (r.flag is null or r.flag = 'ok')
  group by p.id, p.nickname
  order by count(r.id) desc, p.id asc
  limit 10;
$$;
revoke all on function public.get_promoter_ranking() from public;
grant execute on function public.get_promoter_ranking() to anon, authenticated;

-- One-time check of rows that already exist (only touches rows never reviewed)
update public.preregistrations r
set flag = 'bot_nick'
where r.flag is null
  and r.nickname ~ '^[A-Z][a-z]{2,}[A-Z][a-z]{2,}[0-9]{4}$';

update public.preregistrations r
set flag = coalesce(r.flag || ',', '') || 'ref_burst'
where r.referrer is not null
  and (r.flag is null or r.flag = 'bot_nick')
  and (
    select count(*) from public.preregistrations x
    where lower(x.referrer) = lower(r.referrer)
      and x.created_at between r.created_at - make_interval(mins => public.cfg_int('ref_burst_min', 10))
                           and r.created_at + make_interval(mins => public.cfg_int('ref_burst_min', 10))
  ) >= public.cfg_int('ref_burst_n', 5);

-- ============================================================
-- 8. Lock down internal functions
--    Supabase grants EXECUTE on every new public function to anon/authenticated
--    by default, so "revoke ... from public" alone is not enough.
-- ============================================================
revoke execute on function public.request_ip() from anon, authenticated;
revoke execute on function public.prereg_ip_guard() from anon, authenticated;
revoke execute on function public.cfg_int(text, int) from anon, authenticated;
revoke execute on function public.prereg_abuse_guard() from anon, authenticated;

-- ============================================================
-- 6. Register an admin (run separately after creating the user)
--    Replace the email, then run only this statement.
-- ============================================================
-- insert into public.admins (user_id, note)
-- select id, email from auth.users where email = 'admin@example.com'
-- on conflict do nothing;
