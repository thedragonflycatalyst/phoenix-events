-- AI flyer scanning limits and Phoenix Bot, the automatic moderator (owner approval 2026-11-05).
--
-- 1. phoenix_ai_calls: one row per AI scan step, so each person has a daily limit (written by phoenix-scan only).
-- 2. Comments can be 'hidden' (by Phoenix Bot) as well as visible or removed.
-- 3. phoenix_bot_reviews: Phoenix Bot's verdict on every new or edited event and comment.
--    ok: nothing happens · unsure: waits in Review posts · hide: hidden at once until a human clears or confirms it.
-- 4. New and edited posts and comments are sent to the phoenix-bot function (imported events are not).
-- 5. phoenix_bot_apply (bot only) and phoenix_bot_decide (moderators): the only ways a verdict changes a post.

create table public.phoenix_ai_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('scan_read', 'scan_verify')),
  at timestamptz not null default now()
);
create index phoenix_ai_calls_user_kind_at on public.phoenix_ai_calls (user_id, kind, at);
alter table public.phoenix_ai_calls enable row level security;
-- No policies: only the phoenix-scan function (service role) reads and writes it.

alter table public.phoenix_comments drop constraint phoenix_comments_status_check;
alter table public.phoenix_comments add constraint phoenix_comments_status_check
  check (status = any (array['visible', 'hidden', 'removed']));

create table public.phoenix_bot_reviews (
  id uuid primary key default gen_random_uuid(),
  target_kind text not null check (target_kind in ('event', 'comment')),
  target_id uuid not null,
  verdict text not null check (verdict in ('ok', 'unsure', 'hide')),
  categories text[] not null default '{}' check (cardinality(categories) <= 8),
  reason text check (reason is null or length(reason) <= 500),
  model text check (model is null or length(model) <= 80),
  created_at timestamptz not null default now(),
  decision text check (decision in ('cleared', 'confirmed')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  unique (target_kind, target_id)
);
create index phoenix_bot_reviews_open on public.phoenix_bot_reviews (created_at) where verdict <> 'ok' and decision is null;
alter table public.phoenix_bot_reviews enable row level security;
create policy phoenix_bot_reviews_read on public.phoenix_bot_reviews
  for select using (public.phoenix_has_role(array['admin', 'moderator']));

-- Sends a new or edited post to Phoenix Bot (the same server secret the importer uses).
create or replace function public.phoenix_bot_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.phoenix_importing() then return new; end if;
  if tg_table_name = 'phoenix_events' and new.source = 'import' then return new; end if;
  perform net.http_post(
    url := 'https://fkksaivdznqbfsfsagsj.supabase.co/functions/v1/phoenix-bot',
    headers := jsonb_build_object('content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'phoenix_import_secret')),
    body := jsonb_build_object('kind', case when tg_table_name = 'phoenix_events' then 'event' else 'comment' end, 'id', new.id),
    timeout_milliseconds := 60000);
  return new;
end $$;
revoke all on function public.phoenix_bot_notify() from public, anon, authenticated;

create trigger phoenix_events_bot after insert on public.phoenix_events
  for each row execute function public.phoenix_bot_notify();
create trigger phoenix_events_bot_edit after update of title, description, poster_path, url on public.phoenix_events
  for each row when (pg_trigger_depth() = 0 and (old.title, old.description, old.poster_path, old.url)
    is distinct from (new.title, new.description, new.poster_path, new.url))
  execute function public.phoenix_bot_notify();
create trigger phoenix_comments_bot after insert on public.phoenix_comments
  for each row execute function public.phoenix_bot_notify();

-- Phoenix Bot records its verdict; 'hide' hides the post until a human decides. Never deletes anything.
-- A post a human already decided on is not hidden again unless it was edited afterwards.
create or replace function public.phoenix_bot_apply(
  p_kind text, p_id uuid, p_verdict text, p_categories text[], p_reason text, p_model text
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_kind not in ('event', 'comment') or p_verdict not in ('ok', 'unsure', 'hide') then
    raise exception 'phoenix_bot_bad_input';
  end if;
  insert into public.phoenix_bot_reviews (target_kind, target_id, verdict, categories, reason, model)
  values (p_kind, p_id, p_verdict, coalesce(p_categories[1:8], '{}'), left(p_reason, 500), left(p_model, 80))
  on conflict (target_kind, target_id) do update
    set verdict = excluded.verdict, categories = excluded.categories, reason = excluded.reason, model = excluded.model,
        created_at = now(), decision = null, decided_by = null, decided_at = null;
  if p_verdict <> 'hide' then return; end if;
  perform set_config('phoenix.import', 'on', true); -- lets this update pass the events guard
  if p_kind = 'event' then
    update public.phoenix_events
      set status = 'hidden', mod_note = left('Hidden by Phoenix Bot: ' || coalesce(p_reason, ''), 1000)
      where id = p_id and status = 'published';
  else
    update public.phoenix_comments set status = 'hidden' where id = p_id and status = 'visible';
  end if;
  perform set_config('phoenix.import', '', true);
end $$;
revoke all on function public.phoenix_bot_apply(text, uuid, text, text[], text, text) from public, anon, authenticated;
grant execute on function public.phoenix_bot_apply(text, uuid, text, text[], text, text) to service_role;

-- A moderator clears (puts it back) or confirms (removes it) what Phoenix Bot hid or questioned.
create or replace function public.phoenix_bot_decide(p_review uuid, p_decision text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.phoenix_bot_reviews;
begin
  if not public.phoenix_has_role(array['admin', 'moderator']) then
    raise exception 'phoenix_not_allowed' using errcode = '42501';
  end if;
  if p_decision not in ('cleared', 'confirmed') then raise exception 'phoenix_bot_bad_input'; end if;
  select * into r from public.phoenix_bot_reviews where id = p_review for update;
  if r is null then raise exception 'phoenix_not_found'; end if;
  update public.phoenix_bot_reviews
    set decision = p_decision, decided_by = (select auth.uid()), decided_at = now() where id = p_review;
  perform set_config('phoenix.import', 'on', true);
  if r.target_kind = 'event' then
    if p_decision = 'cleared' then
      update public.phoenix_events set status = 'published', mod_note = null, reviewed_at = now(), reviewed_by = (select auth.uid())
        where id = r.target_id and status = 'hidden';
      update public.phoenix_events set reviewed_at = now(), reviewed_by = (select auth.uid())
        where id = r.target_id and status = 'published';
    else
      update public.phoenix_events set status = 'removed', reviewed_at = now(), reviewed_by = (select auth.uid())
        where id = r.target_id;
    end if;
  else
    update public.phoenix_comments set status = case when p_decision = 'cleared' then 'visible' else 'removed' end
      where id = r.target_id and status <> 'removed';
  end if;
  perform set_config('phoenix.import', '', true);
end $$;
revoke all on function public.phoenix_bot_decide(uuid, text) from public, anon;
grant execute on function public.phoenix_bot_decide(uuid, text) to authenticated;

-- What Phoenix Bot hid or questioned and nobody has decided yet, with enough to judge it.
create or replace function public.phoenix_bot_queue()
returns table (review_id uuid, target_kind text, target_id uuid, verdict text, categories text[], reason text,
  created_at timestamptz, title text, body text, username text, event_id uuid)
language sql stable security definer set search_path = '' as $$
  select b.id, b.target_kind, b.target_id, b.verdict, b.categories, b.reason, b.created_at,
    coalesce(e.title, ce.title), coalesce(e.description, c.body), coalesce(e.created_by_username, c.username),
    coalesce(e.id, c.event_id)
  from public.phoenix_bot_reviews b
  left join public.phoenix_events e on b.target_kind = 'event' and e.id = b.target_id
  left join public.phoenix_comments c on b.target_kind = 'comment' and c.id = b.target_id
  left join public.phoenix_events ce on ce.id = c.event_id
  where b.verdict <> 'ok' and b.decision is null and public.phoenix_has_role(array['admin', 'moderator'])
  order by (b.verdict = 'hide') desc, b.created_at;
$$;
revoke all on function public.phoenix_bot_queue() from public, anon;
grant execute on function public.phoenix_bot_queue() to authenticated;
