-- Run: sed '/^-- Every day at 05:10/,$d' supabase/migrations/20261110010000_phoenix_agent_events_and_yearly.sql > /tmp/agent.sql
--      psql -d <scratch db> -v mig=/tmp/agent.sql -f supabase/tests/phoenix_agent_events.test.sql
-- Stubs auth and the parts of the live schema the migration touches (copied from production, Nov 9).
\set ON_ERROR_STOP on
create schema auth; create table auth.users(id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin create role anon; exception when others then null; end $$;
do $$ begin create role authenticated; exception when others then null; end $$;
do $$ begin create role service_role; exception when others then null; end $$;
create table public.phoenix_roles(user_id uuid, role text);
create table public.dragonfly_profiles(user_id uuid primary key, username text);
create function public.phoenix_importing() returns boolean language sql stable as $$ select coalesce(current_setting('phoenix.importing', true), '') = 'on' $$;
create table public.phoenix_events(id uuid primary key default gen_random_uuid(), created_by uuid default auth.uid(), created_by_username text,
  title text not null, description text, starts_at timestamptz not null, ends_at timestamptz, all_day boolean not null default false,
  timezone text not null default 'America/New_York', location_name text, address text, lat double precision, lng double precision,
  category text not null default 'community', organizer text, url text, poster_path text, source text not null default 'manual',
  is_tpc boolean not null default false, volunteer_slots int, going_count int not null default 0, volunteer_count int not null default 0,
  status text not null default 'published', reviewed_at timestamptz, reviewed_by uuid, mod_note text, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), cost text not null default 'free', tags text[] not null default '{}', is_youth boolean not null default false,
  chaperone_ratio text, import_source_id uuid, import_uid text);
create function public.phoenix_events_guard() returns trigger language plpgsql as $$ begin return new; end $$;
create trigger phoenix_events_guard before insert or update on public.phoenix_events for each row execute function public.phoenix_events_guard();
\i :mig
grant usage on schema public, auth to authenticated, anon, service_role; grant execute on function auth.uid() to authenticated, anon, service_role;
grant select, insert, update on public.phoenix_events to authenticated, service_role;
insert into auth.users values ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222');
insert into public.phoenix_roles values ('11111111-1111-1111-1111-111111111111', 'owner');
insert into public.dragonfly_profiles values ('11111111-1111-1111-1111-111111111111', 'owner1'), ('22222222-2222-2222-2222-222222222222', 'member2');

-- 1. Agent creates an event for the owner: created_by is the owner, audited, protected fields reset.
set role service_role;
select public.phoenix_agent_create_event('shasta', '11111111-1111-1111-1111-111111111111',
  '{"title":"Lantern Night","starts_at":"2026-12-21T00:00:00-05:00","all_day":true,"organizer":"The Lionheart Society","repeat_yearly":true,"status":"removed","going_count":99}', 'owner approved') as eid \gset
reset role;
do $$ declare e public.phoenix_events; begin
  select * into e from public.phoenix_events where title = 'Lantern Night';
  if e.created_by <> '11111111-1111-1111-1111-111111111111' or e.created_by_username <> 'owner1' then raise exception 'created_by wrong'; end if;
  if e.status <> 'published' or e.going_count <> 0 then raise exception 'protected fields not reset'; end if;
  if not e.repeat_yearly then raise exception 'owner can set repeat_yearly'; end if;
  if (select count(*) from public.phoenix_agent_log where agent = 'shasta' and action = 'create_event' and event_id = e.id) <> 1 then raise exception 'no audit'; end if;
  if current_setting('phoenix.acting_for', true) not in ('', null) then raise exception 'acting_for leaked'; end if;
end $$;

-- 2. Agents can't act for a non-admin, and need a name.
set role service_role;
do $$ begin perform public.phoenix_agent_create_event('shasta', '22222222-2222-2222-2222-222222222222', '{"title":"X","starts_at":"2026-12-01T10:00:00Z"}');
  raise exception 'acted for non-admin'; exception when insufficient_privilege then null; end $$;
do $$ begin perform public.phoenix_agent_create_event(' ', '11111111-1111-1111-1111-111111111111', '{"title":"X","starts_at":"2026-12-01T10:00:00Z"}');
  raise exception 'no agent name'; exception when sqlstate '22023' then null; end $$;
reset role;

-- 3. App users can't call the agent door, read the log, or ride acting_for.
set role authenticated; select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ begin perform public.phoenix_agent_create_event('x', '11111111-1111-1111-1111-111111111111', '{"title":"X","starts_at":"2026-12-01T10:00:00Z"}');
  raise exception 'client called agent rpc'; exception when insufficient_privilege then null; end $$;
select count(*) as member_sees_log from public.phoenix_agent_log;
select set_config('phoenix.acting_for', '11111111-1111-1111-1111-111111111111', false);
insert into public.phoenix_events(title, starts_at, repeat_yearly, is_tpc) values ('Member event', '2026-12-05T15:00:00Z', true, true);
select created_by = '22222222-2222-2222-2222-222222222222' as own_id, repeat_yearly, is_tpc from public.phoenix_events where title = 'Member event';
select set_config('phoenix.acting_for', '', false);
-- anon with acting_for set still can't post
select set_config('request.jwt.claim.sub', '', false); reset role; set role anon;
select set_config('phoenix.acting_for', '11111111-1111-1111-1111-111111111111', false);
do $$ begin perform public.phoenix_acting_for(); raise exception 'anon can call'; exception when insufficient_privilege then null; end $$;
reset role; select set_config('phoenix.acting_for', '', false);

-- 4. Yearly roll: once started, next year's copy appears in the same series; the old one stops repeating.
update public.phoenix_events set starts_at = now() - interval '1 hour', ends_at = now() - interval '1 hour' where title = 'Lantern Night';
select public.phoenix_roll_yearly() as rolled;
select public.phoenix_roll_yearly() as rolled_again;
select count(*) as copies, count(distinct series_id) as series, sum(repeat_yearly::int) as still_repeating,
  bool_and(created_by = '11111111-1111-1111-1111-111111111111') as same_owner from public.phoenix_events where title = 'Lantern Night';
select (max(starts_at) - min(starts_at)) between interval '365 days' and interval '366 days' as one_year_apart from public.phoenix_events where title = 'Lantern Night';
