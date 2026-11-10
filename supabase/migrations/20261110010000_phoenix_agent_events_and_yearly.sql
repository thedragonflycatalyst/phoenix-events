-- 1) Agent posting on the owner's authority (owner approval, Nov 9 2026, 21:58 ET: "give yourself access to create
--    events on my authority. I approve it."). Claude chats create events through ONE service-only RPC that names the
--    agent, acts as a named Phoenix owner/admin, and writes an audit row. Nothing changes for app users.
-- 2) Events that repeat every year (e.g. Lantern Night, Dec 21). Organizers/admins switch "Repeats every year" on;
--    once an occurrence has started, a daily job adds next year's copy, so one is always upcoming.

-- Who an agent is acting for. Only honored outside client requests (no JWT user, and not the anon/authenticated
-- roles PostgREST uses), and only while phoenix_agent_create_event / phoenix_roll_yearly set it for one transaction.
create or replace function public.phoenix_acting_for() returns uuid
language sql stable set search_path = '' as $$
  select case
    when (select auth.uid()) is null and coalesce(current_setting('role', true), 'none') not in ('anon', 'authenticated')
    then nullif(current_setting('phoenix.acting_for', true), '')::uuid
  end
$$;
revoke all on function public.phoenix_acting_for() from public, anon, authenticated;

-- Roles follow the acting user when an agent posts (owner keeps owner rights; nobody else gains any).
create or replace function public.phoenix_has_role(roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.phoenix_roles r
    where r.user_id = coalesce((select auth.uid()), public.phoenix_acting_for()) and (r.role = any(roles) or r.role = 'owner'));
$$;

alter table public.phoenix_events add column if not exists repeat_yearly boolean not null default false;
alter table public.phoenix_events add column if not exists series_id uuid;

-- Same guard as before, plus: the acting user stands in for auth.uid() on agent inserts, and only organizers/admins
-- can make an event repeat yearly.
create or replace function public.phoenix_events_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  is_mod boolean;
  can_tpc boolean;
  recent integer;
begin
  if public.phoenix_importing() then return new; end if;
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then return new; end if;
  is_mod := public.phoenix_has_role(array['admin','moderator']);
  can_tpc := public.phoenix_has_role(array['admin','organizer']);
  if tg_op = 'INSERT' then
    new.created_by := coalesce((select auth.uid()), public.phoenix_acting_for());
    if new.created_by is null then raise exception 'phoenix_sign_in_required' using errcode = '42501'; end if;
    perform pg_advisory_xact_lock(hashtextextended('phoenix_events:' || new.created_by::text, 0));
    select count(*) into recent from public.phoenix_events e where e.created_by = new.created_by and e.created_at > now() - interval '1 day';
    if recent >= 20 and not is_mod then
      raise exception 'phoenix_rate_limited' using errcode = 'P0001', hint = 'At most 20 new events per day.';
    end if;
    select p.username into new.created_by_username from public.dragonfly_profiles p where p.user_id = new.created_by;
    new.created_at := now(); new.updated_at := now();
    new.status := 'published'; new.going_count := 0; new.volunteer_count := 0;
    new.reviewed_at := null; new.reviewed_by := null; new.mod_note := null;
    new.source := case when new.source = 'poster' then 'poster' else 'manual' end;
    new.import_source_id := null; new.import_uid := null;
    if not can_tpc then new.is_tpc := false; new.volunteer_slots := null; new.repeat_yearly := false; new.series_id := null; end if;
    if new.is_tpc then new.reviewed_at := now(); new.reviewed_by := new.created_by; end if;
    return new;
  end if;
  new.id := old.id; new.created_by := old.created_by; new.created_by_username := old.created_by_username;
  new.created_at := old.created_at; new.going_count := old.going_count; new.volunteer_count := old.volunteer_count;
  new.source := old.source; new.import_source_id := old.import_source_id; new.import_uid := old.import_uid;
  new.series_id := old.series_id;
  new.updated_at := now();
  if not can_tpc then new.is_tpc := old.is_tpc; new.volunteer_slots := old.volunteer_slots; new.repeat_yearly := old.repeat_yearly; end if;
  if not is_mod then
    new.status := case when old.status = 'removed' or new.status = 'removed' then 'removed' else old.status end;
    new.reviewed_at := old.reviewed_at; new.reviewed_by := old.reviewed_by; new.mod_note := old.mod_note;
  elsif new.status is distinct from old.status or new.reviewed_at is distinct from old.reviewed_at then
    new.reviewed_at := now(); new.reviewed_by := coalesce((select auth.uid()), public.phoenix_acting_for());
  end if;
  return new;
end $$;

-- Audit: every agent action, readable by Phoenix admins in the app.
create table if not exists public.phoenix_agent_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  agent text not null check (char_length(agent) between 1 and 60),
  on_behalf_of uuid not null,
  action text not null,
  event_id uuid,
  note text check (char_length(note) <= 500)
);
alter table public.phoenix_agent_log enable row level security;
revoke all on public.phoenix_agent_log from anon, authenticated;
grant select on public.phoenix_agent_log to authenticated;
drop policy if exists phoenix_agent_log_admins on public.phoenix_agent_log;
create policy phoenix_agent_log_admins on public.phoenix_agent_log for select to authenticated using (public.phoenix_has_role(array['admin']));

-- The one door for agents. p_event uses phoenix_events column names; the guard still sets status, counts, source,
-- created_by and all other protected fields, and every normal trigger (duplicates, bans, bot post) still runs.
create or replace function public.phoenix_agent_create_event(p_agent text, p_owner uuid, p_event jsonb, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare e public.phoenix_events; eid uuid;
begin
  if coalesce(btrim(p_agent), '') = '' then raise exception 'agent name required' using errcode = '22023'; end if;
  if not exists (select 1 from public.phoenix_roles r where r.user_id = p_owner and r.role in ('owner', 'admin')) then
    raise exception 'phoenix_not_authorized' using errcode = '42501', hint = 'Agents act only for a Phoenix owner or admin.';
  end if;
  e := jsonb_populate_record(null::public.phoenix_events, p_event);
  if coalesce(btrim(e.title), '') = '' or e.starts_at is null then raise exception 'title and starts_at required' using errcode = '22023'; end if;
  perform set_config('phoenix.acting_for', p_owner::text, true);
  insert into public.phoenix_events (title, description, starts_at, ends_at, all_day, timezone, location_name, address, lat, lng,
      category, organizer, url, cost, tags, is_tpc, volunteer_slots, is_youth, chaperone_ratio, repeat_yearly)
    values (e.title, e.description, e.starts_at, e.ends_at, coalesce(e.all_day, false), coalesce(e.timezone, 'America/New_York'),
      e.location_name, e.address, e.lat, e.lng, coalesce(e.category, 'community'), e.organizer, e.url, coalesce(e.cost, 'free'),
      coalesce(e.tags, '{}'), coalesce(e.is_tpc, false), e.volunteer_slots, coalesce(e.is_youth, false), e.chaperone_ratio,
      coalesce(e.repeat_yearly, false))
    returning id into eid;
  perform set_config('phoenix.acting_for', '', true);
  insert into public.phoenix_agent_log (agent, on_behalf_of, action, event_id, note) values (btrim(p_agent), p_owner, 'create_event', eid, p_note);
  return eid;
end $$;
revoke all on function public.phoenix_agent_create_event(text, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.phoenix_agent_create_event(text, uuid, jsonb, text) to service_role;

-- Yearly events: once an occurrence has started, add next year's (same day and time), carrying the series.
create or replace function public.phoenix_roll_yearly() returns integer
language plpgsql security definer set search_path = '' as $$
declare r public.phoenix_events; n integer := 0; nid uuid;
begin
  for r in select * from public.phoenix_events where repeat_yearly and status = 'published' and starts_at <= now() for update skip locked loop
    perform set_config('phoenix.acting_for', r.created_by::text, true);
    insert into public.phoenix_events (title, description, starts_at, ends_at, all_day, timezone, location_name, address, lat, lng,
        category, organizer, url, cost, tags, is_tpc, volunteer_slots, is_youth, chaperone_ratio, repeat_yearly, series_id)
      values (r.title, r.description, r.starts_at + interval '1 year', r.ends_at + interval '1 year', r.all_day, r.timezone,
        r.location_name, r.address, r.lat, r.lng, r.category, r.organizer, r.url, r.cost, r.tags, r.is_tpc, r.volunteer_slots,
        r.is_youth, r.chaperone_ratio, true, coalesce(r.series_id, r.id))
      returning id into nid;
    update public.phoenix_events set repeat_yearly = false, series_id = coalesce(series_id, id) where id = r.id;
    n := n + 1;
  end loop;
  perform set_config('phoenix.acting_for', '', true);
  return n;
end $$;
revoke all on function public.phoenix_roll_yearly() from public, anon, authenticated;

-- Every day at 05:10 UTC (pg_cron; left out of local tests).
select cron.schedule('phoenix-roll-yearly', '10 5 * * *', $$select public.phoenix_roll_yearly()$$);
