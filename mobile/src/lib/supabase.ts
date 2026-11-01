import 'expo-sqlite/localStorage/install';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { AppState } from 'react-native';

const extra = Constants.expoConfig?.extra as { supabaseUrl: string; supabaseKey: string; webUrl: string };
export const SUPABASE_URL = extra.supabaseUrl;
export const SUPABASE_KEY = extra.supabaseKey;
export const WEB_URL = extra.webUrl;
export const CALENDAR_FN = `${SUPABASE_URL}/functions/v1/phoenix-calendar`;
export const USERNAME_LOGIN_FN = `${SUPABASE_URL}/functions/v1/dragonfly-username-login`;

// Shared Dragonfly account system (same project as the Uploader and Lapis).
export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { storage: localStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});

AppState.addEventListener('change', (state) => {
  if (state === 'active') sb.auth.startAutoRefresh();
  else sb.auth.stopAutoRefresh();
});

export const posterUrl = (p?: string | null) => (p ? sb.storage.from('phoenix-posters').getPublicUrl(p).data.publicUrl : undefined);
export const shareUrl = (id: string) => `${WEB_URL}#/event/${id}`;

// Small persistent key-value helpers (localStorage is backed by SQLite on the device)
export function store<T>(key: string, val: T) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ } }
export function recall<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
