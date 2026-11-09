-- Run: sed '/^-- Every 15 minutes/,$d' supabase/migrations/20261109010000_phoenix_texts.sql > /tmp/phx.sql && psql -d <scratch db> -v mig=/tmp/phx.sql -f supabase/tests/phoenix_texts.test.sql
-- (stubs auth and phoenix_events; the cron block needs pg_cron so it's left out locally)
\set ON_ERROR_STOP on
create schema auth; create table auth.users(id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin create role anon; exception when others then null; end $$;
do $$ begin create role authenticated; exception when others then null; end $$;
create table public.phoenix_events(id uuid primary key default gen_random_uuid());
\i :mig
grant usage on schema public, auth to authenticated; grant execute on function auth.uid() to authenticated;
insert into auth.users values ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222');
set role authenticated; select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select public.phoenix_text_opt_in('(410) 555-0134', true);
do $$ begin perform public.phoenix_text_opt_in('555-0134', true); raise exception 'should fail'; exception when sqlstate '22023' then null; end $$;
select phone, sms_on from public.phoenix_text_contacts;
do $$ begin perform 1 from public.phoenix_text_outbox; raise exception 'outbox visible'; exception when insufficient_privilege then null; end $$;
do $$ begin insert into public.phoenix_text_contacts(user_id, phone, sms_on) values ('11111111-1111-1111-1111-111111111111','+14105550199',true); raise exception 'direct write'; exception when insufficient_privilege then null; end $$;
select public.phoenix_text_opt_in('4105550134', true); -- already on: no second welcome
select public.phoenix_text_opt_in(null, false);
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select count(*) as other_sees from public.phoenix_text_contacts;
reset role;
select stage, count(*) from public.phoenix_text_outbox group by stage;
select sms_on, opted_out_at is not null as out from public.phoenix_text_contacts;
