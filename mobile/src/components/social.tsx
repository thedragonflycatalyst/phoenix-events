// TikTok-style hearts and comments for an event.
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useApp } from '@/lib/app-state';
import { compact, eventSocial, listComments, setEventLike, timeAgo, type Comment, type Social } from '@/lib/social';
import { F, usePalette } from '@/lib/theme';
import { Icon, Txt, useToast } from './ui';

/** A colored initial for people in comments (profile pictures stay private to each account). */
export function NameBadge({ name, size = 34 }: { name: string | null; size?: number }) {
  const p = usePalette();
  const n = (name ?? '?').replace(/^@/, '');
  const colors = Object.values(p.cat);
  const color = colors[[...n].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % colors.length];
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: F.display, fontSize: size * 0.44, color: '#fff' }}>{n.charAt(0).toUpperCase()}</Text>
    </View>
  );
}

/** Solid heart drawn from shapes (the ♥ character turns into a red emoji on Android). Pops when turned on. */
export function Heart({ on, size = 30, idle = '#fff' }: { on: boolean; size?: number; idle?: string }) {
  const pop = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!on) return;
    Animated.sequence([
      Animated.spring(pop, { toValue: 1.35, useNativeDriver: true, speed: 40, bounciness: 14 }),
      Animated.spring(pop, { toValue: 1, useNativeDriver: true, speed: 20 }),
    ]).start();
  }, [on, pop]);
  const color = on ? '#ff3b5c' : idle;
  const u = size * 0.56; // lobe diameter and square side
  return (
    <Animated.View style={{ width: size, height: size, transform: [{ scale: pop }] }}>
      <View style={{ position: 'absolute', left: (size - u) / 2, top: size * 0.3, width: u, height: u, backgroundColor: color, transform: [{ rotate: '45deg' }] }} />
      <View style={{ position: 'absolute', left: size * 0.5 - u * 0.86, top: size * 0.12, width: u, height: u, borderRadius: u / 2, backgroundColor: color }} />
      <View style={{ position: 'absolute', left: size * 0.5 - u * 0.14, top: size * 0.12, width: u, height: u, borderRadius: u / 2, backgroundColor: color }} />
    </Animated.View>
  );
}

export function useSocial(eventId: string) {
  const { user } = useApp();
  const toast = useToast();
  const [s, setS] = useState<Social>({ likes: 0, comments: 0, liked: false });
  const load = useCallback(() => { eventSocial(eventId).then(setS).catch(() => {}); }, [eventId]);
  useEffect(load, [load, user?.id]);
  const toggleLike = async () => {
    if (!user) { router.push('/sign-in'); return; }
    const like = !s.liked;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setS((x) => ({ ...x, liked: like, likes: Math.max(0, x.likes + (like ? 1 : -1)) }));
    try { await setEventLike(eventId, user.id, like); } catch { load(); toast('Couldn’t save that. Try again.', false); }
  };
  return { social: s, reload: load, toggleLike };
}

/** Floating heart / comments / share column over the event poster. */
export function SocialRail({ social, onLike, onComments, onShare }: { social: Social; onLike: () => void; onComments: () => void; onShare: () => void }) {
  return (
    <View style={st.rail}>
      <RailBtn label={`${social.liked ? 'Unlike' : 'Like'}, ${social.likes} hearts`} onPress={onLike} count={social.likes}>
        <Heart on={social.liked} size={26} />
      </RailBtn>
      <RailBtn label={`Comments, ${social.comments}`} onPress={onComments} count={social.comments}>
        <Icon name="chat_bubble" size={24} color="#fff" />
      </RailBtn>
      <RailBtn label="Share" onPress={onShare}>
        <Icon name="share" size={23} color="#fff" />
      </RailBtn>
    </View>
  );
}

function RailBtn({ children, count, label, onPress }: { children: React.ReactNode; count?: number; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8} style={({ pressed }) => [st.railBtn, { transform: [{ scale: pressed ? 0.9 : 1 }] }]}>
      <View style={st.railCircle}>{children}</View>
      {count !== undefined && <Text style={[st.railCount, st.shadow]}>{compact(count)}</Text>}
    </Pressable>
  );
}

/** The two newest comments under the event details, with a link to the full thread. */
export function CommentsPreview({ eventId, count, refreshKey }: { eventId: string; count: number; refreshKey: number }) {
  const p = usePalette();
  const [top, setTop] = useState<Comment[]>([]);
  useEffect(() => { listComments(eventId).then(({ comments }) => setTop(comments.filter((c) => !c.parent_id).slice(-2).reverse())).catch(() => setTop([])); }, [eventId, refreshKey]);
  const open = () => router.push({ pathname: '/comments/[id]', params: { id: eventId } });
  return (
    <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={`Open comments, ${count}`} style={({ pressed }) => [st.preview, { backgroundColor: p.surface, borderColor: p.line, opacity: pressed ? 0.85 : 1 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Txt v="h3">Comments {count ? <Text style={{ color: p.muted }}>{compact(count)}</Text> : null}</Txt>
        <Icon name="chevron_right" color={p.muted} />
      </View>
      {top.length ? top.map((c) => (
        <View key={c.id} style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          <NameBadge name={c.username} size={28} />
          <View style={{ flex: 1 }}>
            <Txt v="small"><Text style={{ fontFamily: F.bodyBold, color: p.ink }}>@{c.username ?? 'neighbor'}</Text>  {timeAgo(c.created_at)}</Txt>
            <Txt numberOfLines={2}>{c.body}</Txt>
          </View>
        </View>
      )) : <Txt v="small" style={{ marginTop: 6 }}>Be the first to say something nice, ask a question, or share a tip.</Txt>}
    </Pressable>
  );
}

const st = StyleSheet.create({
  shadow: { textShadowColor: 'rgba(0,0,0,.55)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } },
  rail: { position: 'absolute', right: 12, bottom: 20, alignItems: 'center', gap: 8 },
  railBtn: { alignItems: 'center' },
  railCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,.28)', alignItems: 'center', justifyContent: 'center' },
  railCount: { fontFamily: F.bodyBold, fontSize: 13, color: '#fff', marginTop: 2 },
  preview: { marginTop: 22, borderWidth: 1, borderRadius: 18, padding: 16 },
});
