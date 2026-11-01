import type { User } from '@supabase/supabase-js';
import * as Location from 'expo-location';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { addDays, rangeFor, startOfDay } from './dates';
import { HOME, type PEvent, type Role, type RsvpKind } from './model';
import { recall, sb, store, USERNAME_LOGIN_FN, SUPABASE_KEY } from './supabase';

export type Filters = { when: string; cats: string[]; tags: string[]; cost: string[]; tpc: boolean; q: string; radius: number | null };
const DEFAULT_FILTERS: Filters = { when: 'upcoming', cats: [], tags: [], cost: [], tpc: false, q: '', radius: null };

type Ctx = {
  ready: boolean; user: User | null; username: string | null; role: Role; rsvps: Map<string, RsvpKind>;
  isMod: boolean; canTpc: boolean;
  filters: Filters; setFilters: (f: Partial<Filters>) => void; activeFilterCount: number;
  origin: { lat: number; lng: number; mine: boolean } | null;
  dataVersion: number; bump: () => void;
  signIn: (id: string, password: string) => Promise<void>;
  signUp: (email: string, username: string, password: string) => Promise<'signed-in' | 'confirm-email'>;
  signOut: () => Promise<void>;
  reloadMe: () => Promise<void>;
  setRsvp: (eventId: string, kind: RsvpKind | null) => void;
  search: (from: Date, to: Date | null, limit?: number, override?: Partial<Filters>) => Promise<PEvent[]>;
};
const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => { const c = useContext(AppCtx); if (!c) throw new Error('AppProvider missing'); return c; };

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [rsvps, setRsvps] = useState<Map<string, RsvpKind>>(new Map());
  const [filters, setFiltersState] = useState<Filters>(() => ({ ...DEFAULT_FILTERS, ...recall<Partial<Filters>>('pe.filters', {}) }));
  const [origin, setOrigin] = useState<Ctx['origin']>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const lastUid = useRef<string | null | undefined>(undefined);

  const loadFor = useCallback(async (u: User | null) => {
    setUser(u);
    if (!u) { setUsername(null); setRole(null); setRsvps(new Map()); return; }
    const [p, r, rs] = await Promise.all([
      sb.from('dragonfly_profiles').select('username').eq('user_id', u.id).maybeSingle(),
      sb.from('phoenix_roles').select('role').eq('user_id', u.id).maybeSingle(),
      sb.from('phoenix_rsvps').select('event_id,kind').eq('user_id', u.id),
    ]);
    setUsername(p.data?.username ?? u.email ?? null);
    setRole((r.data?.role as Role) ?? null);
    setRsvps(new Map((rs.data ?? []).map((x: { event_id: string; kind: RsvpKind }) => [x.event_id, x.kind])));
  }, []);

  useEffect(() => {
    sb.auth.getSession().then(async ({ data }) => {
      lastUid.current = data.session?.user.id ?? null;
      await loadFor(data.session?.user ?? null).catch(() => {});
      setReady(true);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => {
      const uid = session?.user.id ?? null;
      if (uid !== lastUid.current) { lastUid.current = uid; setTimeout(() => loadFor(session?.user ?? null).catch(() => {}), 0); }
    });
    return () => sub.subscription.unsubscribe();
  }, [loadFor]);

  const setFilters = useCallback((f: Partial<Filters>) => {
    setFiltersState((prev) => { const next = { ...prev, ...f }; store('pe.filters', next); return next; });
  }, []);

  // Distance filtering needs a starting point: the phone's location if allowed, otherwise Columbia, MD
  useEffect(() => {
    if (!filters.radius || origin) return;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const p = await Location.getLastKnownPositionAsync() ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          if (p) { setOrigin({ lat: p.coords.latitude, lng: p.coords.longitude, mine: true }); return; }
        }
      } catch { /* fall through */ }
      setOrigin({ lat: HOME.lat, lng: HOME.lng, mine: false });
    })();
  }, [filters.radius, origin]);

  const search = useCallback(async (from: Date, to: Date | null, limit = 300, override: Partial<Filters> = {}) => {
    const f = { ...filters, ...override };
    const o = f.radius ? origin ?? { lat: HOME.lat, lng: HOME.lng } : null;
    const { data, error } = await sb.rpc('phoenix_search_events', {
      p_from: from.toISOString(), p_to: to ? to.toISOString() : null,
      p_categories: f.cats.length ? f.cats : null, p_tags: f.tags.length ? f.tags : null, p_cost: f.cost.length ? f.cost : null,
      p_tpc_only: !!f.tpc, p_q: f.q || null,
      p_lat: o?.lat ?? null, p_lng: o?.lng ?? null, p_radius_mi: f.radius ?? null, p_limit: limit,
    });
    if (error) throw error;
    return (data ?? []) as PEvent[];
  }, [filters, origin]);

  const signIn = useCallback(async (id: string, password: string) => {
    if (id.includes('@')) {
      const { error } = await sb.auth.signInWithPassword({ email: id, password });
      if (error) throw error;
      return;
    }
    const res = await fetch(USERNAME_LOGIN_FN, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY },
      body: JSON.stringify({ username: id, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'invalid_credentials');
    const { error } = await sb.auth.setSession({ access_token: body.access_token, refresh_token: body.refresh_token });
    if (error) throw error;
  }, []);

  const signUp = useCallback(async (email: string, uname: string, password: string) => {
    const { data: free } = await sb.rpc('dragonfly_username_available', { wanted: uname });
    if (free === false) throw new Error('dragonfly_username_taken');
    const { data, error } = await sb.auth.signUp({ email, password, options: { data: { username: uname } } });
    if (error) throw error;
    return data.session ? 'signed-in' : 'confirm-email';
  }, []);

  const value = useMemo<Ctx>(() => ({
    ready, user, username, role, rsvps,
    isMod: role === 'admin' || role === 'moderator', canTpc: role === 'admin' || role === 'organizer',
    filters, setFilters,
    activeFilterCount: filters.cats.length + filters.tags.length + filters.cost.length + (filters.tpc ? 1 : 0) + (filters.q ? 1 : 0) + (filters.radius ? 1 : 0),
    origin, dataVersion, bump: () => setDataVersion((v) => v + 1),
    signIn, signUp,
    signOut: async () => { await sb.auth.signOut(); },
    reloadMe: () => loadFor(user),
    setRsvp: (eventId, kind) => setRsvps((prev) => { const m = new Map(prev); if (kind) m.set(eventId, kind); else m.delete(eventId); return m; }),
    search,
  }), [ready, user, username, role, rsvps, filters, setFilters, origin, dataVersion, signIn, signUp, loadFor, search]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export { rangeFor, addDays, startOfDay };
