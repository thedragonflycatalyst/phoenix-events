// Event texts opt-in (owner, Nov 9 2026). Unticked by default; the wording matches what was registered with the carriers
// and published at thedragonflycatalyst.org/phoenix-catalyst/sms-terms. Texts come from (888) 639-3230.
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button, Card, Field, Icon, Txt, useToast } from '@/components/ui';
import { useApp } from '@/lib/app-state';
import { errText } from '@/lib/model';
import { sb } from '@/lib/supabase';
import { usePalette } from '@/lib/theme';

export const SMS_TERMS_URL = 'https://thedragonflycatalyst.org/phoenix-catalyst/sms-terms';
export const CONSENT_TEXT = 'Text me event reminders, volunteer updates and sign-in codes from The Phoenix Catalyst at the number above. Message frequency varies. Message and data rates may apply. Reply HELP for help or STOP to cancel at any time. Agreeing is not required to volunteer or attend.';
const VERSION = 1;

export function TextOptIn() {
  const p = usePalette();
  const app = useApp();
  const toast = useToast();
  const [phone, setPhone] = useState('');
  const [on, setOn] = useState(false);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!app.user) return;
    void sb.from('phoenix_text_contacts').select('phone, sms_on').eq('user_id', app.user.id).maybeSingle().then(({ data }) => {
      if (data) { setPhone(data.phone); setOn(!!data.sms_on); }
    });
  }, [app.user]);
  if (!app.user) return null;

  const save = async (next: boolean) => {
    if (next && !agree) return toast('Tick the box to agree first', false);
    setBusy(true);
    const { error } = await sb.rpc('phoenix_text_opt_in', { p_phone: phone, p_on: next, p_version: VERSION });
    setBusy(false);
    if (error) return toast(error.message.includes('bad_phone') ? 'Enter a US mobile number, like (410) 555-0134' : errText(error), false);
    setOn(next); setAgree(false);
    toast(next ? 'Event texts are on. We just sent a confirmation text.' : 'Event texts are off.');
  };

  return (
    <Card style={{ marginTop: 14, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="sms" />
        <Txt v="bold">Event texts</Txt>
      </View>
      {on ? (
        <>
          <Txt v="small">Reminders for events you’re going to or volunteering at go to {phone}. Reply CONFIRM, or CANT GO if plans change.</Txt>
          <Button small kind="quiet" title="Turn off event texts" busy={busy} style={{ alignSelf: 'flex-start' }} onPress={() => save(false)} />
        </>
      ) : (
        <>
          <Field label="Mobile number" keyboardType="phone-pad" autoComplete="tel" value={phone} onChangeText={setPhone} placeholder="(410) 555-0134" />
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: agree }} onPress={() => setAgree(!agree)} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            <Icon name={agree ? 'check_box' : 'check_box_outline_blank'} color={agree ? p.focus : p.ink} />
            <Txt v="small" style={{ flex: 1 }}>{CONSENT_TEXT}</Txt>
          </Pressable>
          <Pressable onPress={() => void WebBrowser.openBrowserAsync(SMS_TERMS_URL)} accessibilityRole="link">
            <Txt v="small" color={p.focus}>Text terms and privacy</Txt>
          </Pressable>
          <Button title="Turn on event texts" busy={busy} disabled={!agree || !phone.trim()} onPress={() => save(true)} />
        </>
      )}
    </Card>
  );
}
