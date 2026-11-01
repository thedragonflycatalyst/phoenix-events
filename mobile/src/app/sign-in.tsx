import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { Button, Field, Txt, useToast } from '@/components/ui';
import { useApp } from '@/lib/app-state';
import { errText } from '@/lib/model';
import { sb, WEB_URL } from '@/lib/supabase';
import { usePalette } from '@/lib/theme';

export default function SignIn() {
  const p = usePalette();
  const toast = useToast();
  const { signIn, signUp } = useApp();
  const [mode, setMode] = useState<'in' | 'up' | 'sent'>('in');
  const [id, setId] = useState('');
  const [email, setEmail] = useState('');
  const [uname, setUname] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    setErr(''); setBusy(true);
    try {
      if (mode === 'in') {
        if (!id.trim() || !pw) throw new Error('Enter your username or email and password.');
        await signIn(id.trim(), pw);
        toast('Signed in'); router.back();
      } else {
        if (!email.includes('@')) throw new Error('Enter your email.');
        if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{2,29}$/.test(uname)) throw new Error('dragonfly_username_invalid');
        if (pw.length < 8) throw new Error('Use at least 8 characters for your password.');
        const r = await signUp(email.trim(), uname.trim(), pw);
        if (r === 'signed-in') { toast('Welcome! 🔥'); router.back(); } else setMode('sent');
      }
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const forgot = async () => {
    if (!id.includes('@')) return setErr('Enter your account email above, then tap Forgot password.');
    const { error } = await sb.auth.resetPasswordForEmail(id.trim(), { redirectTo: WEB_URL });
    if (error) setErr(errText(error)); else toast('Check your email for a reset link');
  };

  if (mode === 'sent') {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg, padding: 24, paddingTop: 40, gap: 12 }}>
        <Txt v="display">Check your email</Txt>
        <Txt>We sent a confirmation link to <Txt v="bold">{email}</Txt>. Open it, then come back and sign in.</Txt>
        <Button title="Sign in" onPress={() => setMode('in')} style={{ marginTop: 12 }} />
      </View>
    );
  }
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: p.bg }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 24, paddingTop: 32 }}>
        <Txt v="display">{mode === 'in' ? 'Welcome back' : 'Join the community'}</Txt>
        <Txt v="small" style={{ fontSize: 16, marginTop: 8, marginBottom: 24 }}>One Dragonfly account works across all Dragonfly apps.</Txt>
        {mode === 'in' ? (
          <>
            <Field label="Username or email" value={id} onChangeText={setId} autoCapitalize="none" autoComplete="username" autoCorrect={false} />
            <Field label="Password" value={pw} onChangeText={setPw} secureTextEntry autoComplete="current-password" onSubmitEditing={submit} />
          </>
        ) : (
          <>
            <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
            <Field label="Username" hint="(can’t be changed later)" value={uname} onChangeText={setUname} autoCapitalize="none" autoCorrect={false} autoComplete="username-new" />
            <Field label="Password" value={pw} onChangeText={setPw} secureTextEntry autoComplete="new-password" />
          </>
        )}
        {err ? <Txt v="bold" color={p.danger} style={{ marginBottom: 12 }} accessibilityLiveRegion="polite">{err}</Txt> : null}
        <Button title={mode === 'in' ? 'Sign in' : 'Create account'} busy={busy} onPress={submit} />
        <Button kind="ghost" title={mode === 'in' ? 'Create an account' : 'I have an account'} style={{ marginTop: 10 }} onPress={() => { setErr(''); setMode(mode === 'in' ? 'up' : 'in'); }} />
        {mode === 'in' && <Button kind="quiet" small title="Forgot password" style={{ alignSelf: 'center', marginTop: 16 }} onPress={forgot} />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
