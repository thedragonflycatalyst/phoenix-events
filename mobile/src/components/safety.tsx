// Shared prompts for blocking someone and (for moderators) suspending an account.
import { Alert } from 'react-native';
import { errText } from '@/lib/model';
import { banUser, blockUser } from '@/lib/safety';

type Toast = (msg: string, ok?: boolean) => void;

export function confirmBlock(userId: string, username: string | null, toast: Toast, done: () => void) {
  const name = `@${username ?? 'this person'}`;
  Alert.alert(`Block ${name}?`, 'You won’t see their posts or comments anymore. They aren’t told. You can unblock them from your account page.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Block', style: 'destructive', onPress: () => { blockUser(userId).then(() => { toast(`${name} blocked`); done(); }, (e) => toast(errText(e), false)); } },
  ]);
}

export function confirmSuspend(username: string | null, toast: Toast, done: () => void) {
  if (!username) return;
  const go = (days: number | null) => banUser(username, 'Broke the community guidelines', days, true)
    .then(() => { toast(`@${username} suspended${days ? ` for ${days} days` : ''}. Their posts and comments are hidden.`); done(); }, (e) => toast(errText(e), false));
  Alert.alert(`Suspend @${username}?`, 'They won’t be able to post, comment, RSVP or report, and their current posts and comments are hidden. You can lift it from Review community posts.', [
    { text: 'Cancel', style: 'cancel' },
    { text: '7 days', onPress: () => void go(7) },
    { text: '30 days', onPress: () => void go(30) },
    { text: 'Until lifted', style: 'destructive', onPress: () => void go(null) },
  ]);
}
