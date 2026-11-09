// phoenix-sms-inbound: replies to texts sent to The Phoenix Catalyst's number, (888) 639-3230 (Twilio webhook,
// form-encoded, Phoenix's own account). Verifies Twilio's signature, then:
//   CONFIRM / YES            → marks their next reminder confirmed, replies "Perfect! See you there 😁"
//   CANT GO / CAN'T MAKE IT  → drops their RSVP (frees the volunteer spot), thanks them
//   STOP / START             → records the opt-out / opt-in (Twilio itself sends the registered STOP/START/HELP replies)
//   anything else            → "this number is automated" (at most once a day per person)
// Secrets: PHOENIX_TWILIO_AUTH_TOKEN. The URL Twilio signs is the public function URL below.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { AUTOMATED_REPLY, CANT_GO_REPLY, CONFIRM_REPLY, NOTHING_TO_CONFIRM, normPhone, parseReply, safeEqual, twilioSignature, twiml, VOLUNTEER_CANT_GO_REPLY } from '../_shared/phoenix-texts.ts';

const PUBLIC_URL = 'https://fkksaivdznqbfsfsagsj.supabase.co/functions/v1/phoenix-sms-inbound';
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const xml = (msg?: string) => new Response(twiml(msg), { headers: { 'content-type': 'text/xml' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method', { status: 405 });
  const token = Deno.env.get('PHOENIX_TWILIO_AUTH_TOKEN');
  if (!token) return new Response('not configured', { status: 503 });
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(await req.text())) params[k] = v;
  if (!safeEqual(await twilioSignature(token, PUBLIC_URL, params), req.headers.get('x-twilio-signature') ?? '')) return new Response('forbidden', { status: 403 });

  const phone = normPhone(params.From);
  if (!phone) return xml();
  const { data: people } = await admin.from('phoenix_text_contacts').select('user_id, sms_on, last_auto_reply_at').eq('phone', phone);
  if (!people?.length) return xml(); // not someone who signed up for texts: Twilio's own STOP/HELP still apply
  const ids = people.map((p) => p.user_id as string);
  const kind = parseReply(params.Body ?? '');
  const now = new Date();

  if (kind === 'stop' || kind === 'start') {
    await admin.from('phoenix_text_contacts').update(kind === 'stop'
      ? { sms_on: false, opted_out_at: now.toISOString(), updated_at: now.toISOString() }
      : { sms_on: true, opted_out_at: null, updated_at: now.toISOString() }).in('user_id', ids);
    return xml(); // Twilio Advanced Opt-Out sends the registered reply
  }
  if (kind === 'help') return xml();

  if (kind === 'confirm' || kind === 'cant_go') {
    // The reminder they're answering: their soonest upcoming event that we texted them about
    const { data: sent } = await admin.from('phoenix_text_outbox')
      .select('id, user_id, event_id, event:phoenix_events!inner(starts_at)')
      .in('user_id', ids).eq('stage', 'main').eq('status', 'sent').gt('event.starts_at', now.toISOString())
      .order('send_at', { ascending: false }).limit(10);
    const rows = ((sent ?? []) as unknown as { id: string; user_id: string; event_id: string; event: { starts_at: string } }[])
      .sort((a, b) => a.event.starts_at.localeCompare(b.event.starts_at));
    const hit = rows[0];
    if (!hit) return xml(NOTHING_TO_CONFIRM);
    await admin.from('phoenix_text_outbox').update({ reply: kind === 'confirm' ? 'confirmed' : 'cant_go', replied_at: now.toISOString() }).eq('id', hit.id);
    if (kind === 'confirm') return xml(CONFIRM_REPLY);
    const { data: r } = await admin.from('phoenix_rsvps').select('kind').eq('event_id', hit.event_id).eq('user_id', hit.user_id).maybeSingle();
    await admin.from('phoenix_rsvps').delete().eq('event_id', hit.event_id).eq('user_id', hit.user_id);
    return xml(r?.kind === 'volunteer' ? VOLUNTEER_CANT_GO_REPLY : CANT_GO_REPLY);
  }

  // Anything else: point them to the app, at most once a day
  const recent = people.some((p) => p.last_auto_reply_at && now.getTime() - new Date(p.last_auto_reply_at).getTime() < 86400_000);
  if (recent) return xml();
  await admin.from('phoenix_text_contacts').update({ last_auto_reply_at: now.toISOString() }).in('user_id', ids);
  return xml(AUTOMATED_REPLY);
});
