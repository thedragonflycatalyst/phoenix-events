// phoenix-text-outbox: plans and sends Phoenix event texts. Run every 15 minutes by pg_cron (x-cron-secret).
//  1. Plans a reminder (9 AM the day before) and a day-of note for everyone who RSVP'd or volunteers for a published
//     event in the next 3 days and has event texts on.
//  2. Sends queued texts that are due, through Phoenix's own Twilio Messaging Service. A reminder is skipped if they
//     turned texts off, dropped the RSVP, or the event was hidden or moved meanwhile.
// Secrets: PHOENIX_TWILIO_ACCOUNT_SID, PHOENIX_TWILIO_AUTH_TOKEN, PHOENIX_TWILIO_MESSAGING_SERVICE_SID (Phoenix's account,
// never Dragonfly's). Without them nothing is sent and texts stay queued.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { reminderText, sendAt, type Stage } from '../_shared/phoenix-texts.ts';

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

type Ev = { id: string; title: string; starts_at: string; timezone: string; location_name: string | null; all_day: boolean; status: string };
type Rsvp = { user_id: string; kind: 'going' | 'volunteer'; event: Ev };

async function plan(now: Date) {
  const until = new Date(now.getTime() + 3 * 86400_000);
  const { data, error } = await admin.from('phoenix_rsvps')
    .select('user_id, kind, event:phoenix_events!inner(id, title, starts_at, timezone, location_name, all_day, status)')
    .eq('event.status', 'published').gt('event.starts_at', now.toISOString()).lte('event.starts_at', until.toISOString());
  if (error) throw error;
  const rows = (data ?? []) as unknown as Rsvp[];
  if (!rows.length) return 0;
  const { data: on } = await admin.from('phoenix_text_contacts').select('user_id').eq('sms_on', true).in('user_id', [...new Set(rows.map((r) => r.user_id))]);
  const texting = new Set((on ?? []).map((c) => c.user_id as string));
  const queue = [];
  for (const r of rows) {
    if (!texting.has(r.user_id)) continue;
    const start = new Date(r.event.starts_at);
    for (const stage of ['main', 'dayof'] as Stage[]) {
      const at = sendAt(stage, start, r.event.timezone || 'America/New_York', now, r.event.all_day);
      if (!at) continue;
      queue.push({ user_id: r.user_id, event_id: r.event.id, stage, send_at: at.toISOString(),
        body: reminderText(stage, { title: r.event.title, start, tz: r.event.timezone || 'America/New_York', place: r.event.location_name, allDay: r.event.all_day, volunteer: r.kind === 'volunteer' }) });
    }
  }
  if (!queue.length) return 0;
  const { error: e2 } = await admin.from('phoenix_text_outbox').upsert(queue, { onConflict: 'user_id,event_id,stage', ignoreDuplicates: true });
  if (e2) throw e2;
  return queue.length;
}

async function twilioSend(to: string, body: string): Promise<{ sid?: string; error?: string }> {
  const sid = Deno.env.get('PHOENIX_TWILIO_ACCOUNT_SID'), token = Deno.env.get('PHOENIX_TWILIO_AUTH_TOKEN'), svc = Deno.env.get('PHOENIX_TWILIO_MESSAGING_SERVICE_SID');
  if (!sid || !token || !svc) return { error: 'not_configured' };
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { authorization: `Basic ${btoa(`${sid}:${token}`)}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, MessagingServiceSid: svc, Body: body }),
  });
  const j = await r.json().catch(() => ({})) as { sid?: string; message?: string; code?: number };
  return r.ok ? { sid: j.sid } : { error: `${j.code ?? r.status} ${j.message ?? ''}`.trim().slice(0, 300) };
}

async function send(now: Date) {
  const { data: due } = await admin.from('phoenix_text_outbox').select('id, user_id, event_id, stage, body')
    .eq('status', 'queued').lte('send_at', now.toISOString()).order('send_at').limit(100);
  let sent = 0;
  for (const m of due ?? []) {
    const { data: c } = await admin.from('phoenix_text_contacts').select('phone, sms_on').eq('user_id', m.user_id).maybeSingle();
    let skip = !c?.sms_on ? 'texts_off' : null;
    if (!skip && m.event_id) {
      const { data: r } = await admin.from('phoenix_rsvps').select('event:phoenix_events!inner(status, starts_at)').eq('user_id', m.user_id).eq('event_id', m.event_id).maybeSingle();
      const ev = (r as unknown as { event?: { status: string; starts_at: string } } | null)?.event;
      if (!ev) skip = 'no_rsvp';
      else if (ev.status !== 'published' || new Date(ev.starts_at) <= now) skip = 'event_changed';
    }
    if (skip) { await admin.from('phoenix_text_outbox').update({ status: 'skipped', error: skip }).eq('id', m.id); continue; }
    const r = await twilioSend(c!.phone, m.body);
    if (r.error === 'not_configured') return { sent, waiting: 'twilio_not_configured' };
    await admin.from('phoenix_text_outbox').update(r.sid ? { status: 'sent', twilio_sid: r.sid, error: null } : { status: 'failed', error: r.error }).eq('id', m.id);
    if (r.sid) sent++;
  }
  return { sent };
}

Deno.serve(async (req) => {
  const given = req.headers.get('x-cron-secret');
  const ok = !!given && (await admin.rpc('phoenix_import_secret_ok', { p_secret: given })).data === true;
  if (!ok) return json({ error: 'forbidden' }, 403);
  const now = new Date();
  try {
    const planned = await plan(now);
    return json({ planned, ...(await send(now)) });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
