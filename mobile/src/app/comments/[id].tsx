// Comments sheet for an event: TikTok-style list with hearts, one level of replies, and a composer at the bottom.
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/avatar';
import { confirmBlock, confirmSuspend } from '@/components/safety';
import { Heart, PersonPic } from '@/components/social';
import { Icon, Txt, useToast } from '@/components/ui';
import { useApp } from '@/lib/app-state';
import { errText } from '@/lib/model';
import { addComment, compact, deleteComment, listComments, removeComment, reportComment, setCommentLike, timeAgo, type Comment } from '@/lib/social';
import { F, R, usePalette } from '@/lib/theme';

type Row = Comment & { replies: Comment[] };

export default function CommentsSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { user, isMod, refreshBlocks } = useApp();
  const [items, setItems] = useState<Comment[] | null>(null);
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [sending, setSending] = useState(false);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);

  const load = useCallback(async () => {
    try { const r = await listComments(id, user?.id); setItems(r.comments); setLiked(r.liked); }
    catch { setItems([]); }
  }, [id, user?.id]);
  useEffect(() => { void load(); }, [load]);

  // Newest conversations first; replies stay in order under their comment
  const rows = useMemo<Row[]>(() => {
    const all = items ?? [];
    return all.filter((c) => !c.parent_id).reverse().map((c) => ({ ...c, replies: all.filter((r) => r.parent_id === c.id) }));
  }, [items]);
  const total = items?.length ?? 0;

  const send = async () => {
    if (!user) { router.push('/sign-in'); return; }
    const body = text.trim();
    if (!body) return;
    setSending(true);
    try {
      const c = await addComment(id, user.id, body, replyTo?.parent_id ?? replyTo?.id ?? null);
      setItems((x) => [...(x ?? []), c]);
      if (c.parent_id) setOpen((o) => new Set(o).add(c.parent_id!));
      setText(''); setReplyTo(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) { toast(errText(e), false); } finally { setSending(false); }
  };

  const toggleLike = async (c: Comment) => {
    if (!user) { router.push('/sign-in'); return; }
    const like = !liked.has(c.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setLiked((s) => { const n = new Set(s); if (like) n.add(c.id); else n.delete(c.id); return n; });
    setItems((x) => (x ?? []).map((y) => (y.id === c.id ? { ...y, like_count: Math.max(0, y.like_count + (like ? 1 : -1)) } : y)));
    try { await setCommentLike(c.id, user.id, like); } catch { void load(); }
  };

  const menu = (c: Comment) => {
    const mine = user?.id === c.user_id;
    const buttons: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [];
    if (user) buttons.push({ text: 'Reply', onPress: () => startReply(c) });
    if (mine) buttons.push({ text: 'Delete', style: 'destructive', onPress: () => { deleteComment(c.id).then(load, (e) => toast(errText(e), false)); } });
    else if (isMod) buttons.push({ text: 'Remove (moderator)', style: 'destructive', onPress: () => { removeComment(c.id).then(() => { toast('Comment removed'); void load(); }, (e) => toast(errText(e), false)); } });
    if (!mine && user) buttons.push({ text: 'Report', onPress: () => { reportComment(c, user.id).then(() => toast('Report sent to moderators'), (e) => toast(errText(e), false)); } });
    if (!mine && user) buttons.push({ text: `Block @${c.username ?? 'this person'}`, onPress: () => confirmBlock(c.user_id, c.username, toast, () => { refreshBlocks(); void load(); }) });
    if (!mine && isMod) buttons.push({ text: 'Suspend account', style: 'destructive', onPress: () => confirmSuspend(c.username, toast, () => void load()) });
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(`@${c.username ?? 'neighbor'}`, c.body.slice(0, 120), buttons);
  };

  const startReply = (c: Comment) => {
    if (!user) { router.push('/sign-in'); return; }
    setReplyTo(c);
    setTimeout(() => input.current?.focus(), 50);
  };

  const Item = ({ c, reply }: { c: Comment; reply?: boolean }) => (
    <Pressable onLongPress={() => menu(c)} delayLongPress={350} style={{ flexDirection: 'row', gap: 10, paddingVertical: 10, paddingLeft: reply ? 44 : 0 }}
      accessibilityHint="Long press for more options">
      {c.user_id === user?.id ? <Avatar size={reply ? 26 : 34} /> : <PersonPic uid={c.user_id} name={c.username} size={reply ? 26 : 34} />}
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: p.muted }}>@{c.username ?? 'neighbor'}{c.user_id === user?.id ? ' · you' : ''}</Text>
        <Txt style={{ fontSize: 16, lineHeight: 22, marginTop: 2 }}>{c.body}</Txt>
        <View style={{ flexDirection: 'row', gap: 18, marginTop: 6, alignItems: 'center' }}>
          <Txt v="small">{timeAgo(c.created_at)}</Txt>
          <Pressable onPress={() => startReply(c)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Reply to ${c.username ?? 'neighbor'}`}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: p.muted }}>Reply</Text>
          </Pressable>
        </View>
      </View>
      <Pressable onPress={() => toggleLike(c)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`${liked.has(c.id) ? 'Unlike' : 'Like'} comment, ${c.like_count} hearts`}
        style={{ alignItems: 'center', width: 36, paddingTop: 4 }}>
        <Heart on={liked.has(c.id)} size={20} idle={p.muted} />
        <Text style={{ fontFamily: F.body, fontSize: 12, color: p.muted }}>{c.like_count ? compact(c.like_count) : ''}</Text>
      </Pressable>
    </Pressable>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: p.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ alignItems: 'center', paddingTop: 14, paddingBottom: 8 }}>
        <Text style={{ fontFamily: F.displayBold, fontSize: 16, color: p.ink }}>{total ? `${compact(total)} comment${total === 1 ? '' : 's'}` : 'Comments'}</Text>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Close comments" hitSlop={10} style={{ position: 'absolute', right: 16, top: 12 }}>
          <Icon name="close" color={p.muted} />
        </Pressable>
      </View>

      {items === null ? <ActivityIndicator style={{ marginTop: 40 }} color={p.ink} /> : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={{ alignItems: 'center', marginTop: 50, gap: 8 }}>
              <Text style={{ fontSize: 40 }}>💬</Text>
              <Txt v="h3">No comments yet</Txt>
              <Txt v="small" center>Ask a question, share a tip, or tell people you’ll be there.</Txt>
            </View>
          }
          renderItem={({ item: r }) => (
            <View>
              <Item c={r} />
              {r.replies.length > 0 && (open.has(r.id) ? r.replies.map((c) => <Item key={c.id} c={c} reply />) : (
                <Pressable onPress={() => setOpen((o) => new Set(o).add(r.id))} style={{ paddingLeft: 44, paddingBottom: 8 }} accessibilityRole="button">
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: p.muted }}>── View {r.replies.length} repl{r.replies.length === 1 ? 'y' : 'ies'}</Text>
                </Pressable>
              ))}
            </View>
          )}
        />
      )}

      {/* Composer */}
      <View style={{ borderTopWidth: 1, borderTopColor: p.line, backgroundColor: p.surface, paddingHorizontal: 12, paddingTop: 8, paddingBottom: insets.bottom + 8 }}>
        {replyTo && (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 6 }}>
            <Txt v="small">Replying to <Text style={{ fontFamily: F.bodyBold }}>@{replyTo.username ?? 'neighbor'}</Text></Txt>
            <Pressable onPress={() => setReplyTo(null)} hitSlop={10} accessibilityLabel="Cancel reply"><Icon name="close" size={18} color={p.muted} /></Pressable>
          </View>
        )}
        {user ? (
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
            <Avatar size={34} />
            <TextInput ref={input} value={text} onChangeText={setText} placeholder={replyTo ? 'Add a reply…' : 'Add a comment…'} placeholderTextColor={p.muted}
              multiline maxLength={500} accessibilityLabel={replyTo ? 'Reply' : 'Comment'}
              style={{ flex: 1, minHeight: 42, maxHeight: 120, borderRadius: R.lg, backgroundColor: p.soft, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, fontFamily: F.body, fontSize: 16, color: p.ink }} />
            <Pressable onPress={send} disabled={!text.trim() || sending} accessibilityRole="button" accessibilityLabel="Post comment" hitSlop={6}
              style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: text.trim() ? '#ff3b5c' : p.soft }}>
              {sending ? <ActivityIndicator color="#fff" size="small" /> : <Icon name="send" size={20} color={text.trim() ? '#fff' : p.muted} />}
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => router.push('/sign-in')} accessibilityRole="button" style={{ minHeight: 44, borderRadius: R.lg, backgroundColor: p.soft, justifyContent: 'center', paddingHorizontal: 14 }}>
            <Txt color={p.muted}>Sign in to comment</Txt>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
