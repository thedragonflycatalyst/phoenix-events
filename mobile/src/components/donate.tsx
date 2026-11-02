// Donation card, same flow as the website: how often → how much → card or PayPal.
// Card gifts go through the website's Stripe Checkout (/api/donate); PayPal opens PayPal's own donate or subscribe page.
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Button, Card, Txt, useToast } from '@/components/ui';
import { F, R, usePalette } from '@/lib/theme';

const SITE = 'https://thedragonflycatalyst.org';
const PAYPAL = 'ThePhoenixCatalyst@outlook.com';
const FREQS = [['once', 'One time'], ['month', 'Monthly'], ['year', 'Yearly']] as const;
type Freq = (typeof FREQS)[number][0];
const AMOUNTS = ['10', '25', '50'];
const WORDS: Record<Freq, string> = { once: 'one time', month: 'every month', year: 'every year' };

function paypalUrl(a: number, freq: Freq) {
  const q: Record<string, string> = { business: PAYPAL, currency_code: 'USD', no_shipping: '1', return: `${SITE}/phoenix-catalyst/thank-you`, cancel_return: `${SITE}/phoenix-catalyst#donate`, notify_url: `${SITE}/api/paypal-ipn` };
  if (freq === 'once') return `https://www.paypal.com/donate/?${new URLSearchParams({ ...q, amount: a.toFixed(2), item_name: 'Donation to The Phoenix Catalyst', no_recurring: '1' })}`;
  return `https://www.paypal.com/cgi-bin/webscr?${new URLSearchParams({ ...q, cmd: '_xclick-subscriptions', a3: a.toFixed(2), p3: '1', t3: freq === 'month' ? 'M' : 'Y', src: '1', item_name: `${freq === 'month' ? 'Monthly' : 'Yearly'} donation to The Phoenix Catalyst` })}`;
}

function Segment<T extends string>({ items, value, onChange }: { items: readonly (readonly [T, string])[]; value: T; onChange: (v: T) => void }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: p.soft, borderRadius: R.pill, padding: 4 }} accessibilityRole="radiogroup">
      {items.map(([k, l]) => (
        <Pressable key={k} onPress={() => { Haptics.selectionAsync().catch(() => {}); onChange(k); }} accessibilityRole="radio" accessibilityState={{ selected: value === k }}
          style={{ flex: 1, paddingVertical: 10, borderRadius: R.pill, alignItems: 'center', backgroundColor: value === k ? p.surface : 'transparent', borderWidth: value === k ? 1.5 : 0, borderColor: p.focus }}>
          <Text style={{ fontFamily: value === k ? F.bodyBold : F.body, fontSize: 16, color: p.ink }}>{l}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function DonateCard() {
  const p = usePalette();
  const toast = useToast();
  const [freq, setFreq] = useState<Freq>('once');
  const [pick, setPick] = useState('25');
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const raw = pick === 'custom' ? Number(custom.replace(/[^0-9.]/g, '')) : Number(pick);
  const amount = Number.isFinite(raw) && raw >= 5 && raw <= 10000 ? Math.round(raw * 100) / 100 : null;

  const card = async () => {
    if (!amount) return toast('Enter an amount of $5 or more', false);
    setBusy(true);
    try {
      const r = await fetch(`${SITE}/api/donate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount, frequency: freq }) });
      const j = (await r.json()) as { url?: string; error?: string };
      if (!j.url) throw new Error(j.error ?? 'Card checkout isn’t available right now. Please try PayPal, or try again shortly.');
      await WebBrowser.openBrowserAsync(j.url);
    } catch (e) { toast((e as Error).message, false); } finally { setBusy(false); }
  };
  const paypal = () => { if (!amount) return toast('Enter an amount of $5 or more', false); void WebBrowser.openBrowserAsync(paypalUrl(amount, freq)); };

  const Step = ({ n, label }: { n: number; label: string }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18, marginBottom: 10 }}>
      <View style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: p.focus, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: p.ink }}>{n}</Text>
      </View>
      <Txt v="bold">{label}</Txt>
    </View>
  );

  return (
    <Card style={{ borderWidth: 2, borderColor: p.cat.wellness }}>
      <Txt v="kicker" color={p.cat.wellness}>🔥 Donate · tax-deductible</Txt>
      <Txt v="h2" style={{ marginTop: 4 }}>Keep our events free</Txt>
      <Txt v="small" style={{ fontSize: 16, marginTop: 6 }}>Every dollar goes to free community events: cleanup supplies, saplings, food drive logistics, and space for group workouts and mental health gatherings.</Txt>

      <Step n={1} label="How often?" />
      <Segment items={FREQS} value={freq} onChange={setFreq} />

      <Step n={2} label="How much?" />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[...AMOUNTS, 'custom'].map((a) => (
          <Pressable key={a} onPress={() => { Haptics.selectionAsync().catch(() => {}); setPick(a); }} accessibilityRole="radio" accessibilityState={{ selected: pick === a }}
            style={{ flex: a === 'custom' ? 1.6 : 1, minHeight: 52, borderRadius: R.md, alignItems: 'center', justifyContent: 'center', borderWidth: pick === a ? 2 : 1.5, borderColor: pick === a ? p.focus : p.line, backgroundColor: pick === a ? p.soft : 'transparent' }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: a === 'custom' ? 15 : 18, color: p.ink }}>{a === 'custom' ? 'Other' : `$${a}`}</Text>
          </Pressable>
        ))}
      </View>
      {pick === 'custom' && (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, borderWidth: 1.5, borderColor: p.line, borderRadius: R.md, paddingHorizontal: 14 }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 18, color: p.ink }}>$</Text>
          <TextInput value={custom} onChangeText={setCustom} keyboardType="decimal-pad" placeholder="Amount" placeholderTextColor={p.muted} autoFocus maxLength={8}
            accessibilityLabel="Donation amount in dollars" style={{ flex: 1, minHeight: 50, paddingHorizontal: 8, fontFamily: F.body, fontSize: 18, color: p.ink }} />
        </View>
      )}

      <Step n={3} label="How would you like to give?" />
      <Txt style={{ marginBottom: 10 }}>{amount ? `You’re giving $${amount % 1 ? amount.toFixed(2) : amount} ${WORDS[freq]}.` : 'Enter an amount of $5 or more.'}</Txt>
      <Button title="Card, Google Pay or Apple Pay" icon="credit_card" busy={busy} onPress={card} />
      <Button kind="ghost" title="PayPal or Venmo" onPress={paypal} style={{ marginTop: 10 }} />
      <Txt v="small" style={{ marginTop: 12 }}>Monthly and yearly gifts can be cancelled any time. PayPal repeat gifts need a PayPal login. Minimum $5.</Txt>
      <Txt v="small" style={{ marginTop: 6 }}>The Phoenix Catalyst Inc is a 501(c)(3) nonprofit (EIN 41-3050300). You’ll get an emailed receipt for your taxes.</Txt>
    </Card>
  );
}
