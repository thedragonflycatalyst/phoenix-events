-- Phoenix event texts (owner request, Nov 9 2026): event reminders and volunteer confirmations by text from The Phoenix
-- Catalyst's own number, (888) 639-3230 on Phoenix's own Twilio account. Mirrors the Coach app's reminders.
-- Opt-in is an unticked box (wording on thedragonflycatalyst.org/phoenix-catalyst/sms-terms). Twilio answers STOP,
-- START and HELP itself; phoenix-sms-inbound records opt-outs and handles CONFIRM / CANT GO replies.
-- Only the server (service role) reads or writes the outbox; people manage only their own opt-in through the RPC.

create table public.phoenix_text_contacts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone text not null check (phone ~ '^\+1[2-9][0-9]{9}$'),
  sms_on boolean not null default false,
  consent_at timestamptz,
  consent_version int,
  opted_out_at timestamptz,
  last_auto_reply_at timestamptz,
  updated_at timestamptz not null default now()
);
create index phoenix_text_contacts_phone on public.phoenix_text_contacts (phone);
alter table public.phoenix_text_contacts enable row level security;
revoke all on public.phoenix_text_contacts from anon, authenticated;
grant select on public.phoenix_text_contacts to authenticated;
create policy phoenix_text_contacts_own on public.phoenix_text_contacts for select to authenticated using (user_id = (select auth.uid()));

create table public.phoenix_text_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid references public.phoenix_events(id) on delete cascade,
  stage text not null check (stage in ('welcome', 'main', 'dayof')),
  body text not null check (char_length(body) between 1 and 640),
  send_at timestamptz not null default now(),
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  twilio_sid text,
  error text,
  reply text check (reply in ('confirmed', 'cant_go')),
  replied_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index phoenix_text_outbox_once on public.phoenix_text_outbox (user_id, event_id, stage) where event_id is not null;
create index phoenix_text_outbox_due on public.phoenix_text_outbox (send_at) where status = 'queued';
alter table public.phoenix_text_outbox enable row level security;
revoke all on public.phoenix_text_outbox from anon, authenticated;

-- The signed-in person turns event texts on (with their number) or off. Turning on records consent and queues the
-- confirmation text registered with the carriers.
create function public.phoenix_text_opt_in(p_phone text, p_on boolean, p_version int default 1) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); ph text; was boolean;
begin
  if me is null then raise exception 'sign_in' using errcode = '42501'; end if;
  ph := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  if ph ~ '^[0-9]{10}$' then ph := '+1' || ph; elsif ph ~ '^1[0-9]{10}$' then ph := '+' || ph; end if;
  if p_on and ph !~ '^\+1[2-9][0-9]{9}$' then raise exception 'bad_phone' using errcode = '22023'; end if;
  select sms_on into was from public.phoenix_text_contacts where user_id = me;
  if p_on then
    insert into public.phoenix_text_contacts (user_id, phone, sms_on, consent_at, consent_version, opted_out_at, updated_at)
    values (me, ph, true, now(), p_version, null, now())
    on conflict (user_id) do update set phone = excluded.phone, sms_on = true, consent_at = now(), consent_version = excluded.consent_version, opted_out_at = null, updated_at = now();
    if was is distinct from true then
      insert into public.phoenix_text_outbox (user_id, stage, body)
      values (me, 'welcome', 'The Phoenix Catalyst: you''re signed up for event and volunteer texts. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.');
    end if;
  else
    update public.phoenix_text_contacts set sms_on = false, opted_out_at = now(), updated_at = now() where user_id = me;
  end if;
  return jsonb_build_object('sms_on', p_on);
end $$;
revoke execute on function public.phoenix_text_opt_in(text, boolean, int) from public, anon;
grant execute on function public.phoenix_text_opt_in(text, boolean, int) to authenticated;

-- Every 15 minutes: plan and send texts (phoenix-text-outbox checks the same vault secret as the importer)
select cron.schedule('phoenix-text-outbox', '*/15 * * * *', $cron$
  select net.http_post(
    url := 'https://fkksaivdznqbfsfsagsj.supabase.co/functions/v1/phoenix-text-outbox',
    headers := jsonb_build_object('content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'phoenix_import_secret')),
    body := '{}'::jsonb)
$cron$);
