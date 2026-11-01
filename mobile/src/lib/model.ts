import type { Cat } from './theme';

export type PEvent = {
  id: string; created_by: string; created_by_username: string | null;
  title: string; description: string | null; starts_at: string; ends_at: string | null; all_day: boolean; timezone: string;
  location_name: string | null; address: string | null; lat: number | null; lng: number | null;
  category: Cat; organizer: string | null; url: string | null; poster_path: string | null; source: 'manual' | 'poster';
  is_tpc: boolean; volunteer_slots: number | null; going_count: number; volunteer_count: number;
  status: 'published' | 'hidden' | 'removed'; reviewed_at: string | null; cost: 'free' | 'paid' | 'donation'; tags: string[];
  created_at: string; updated_at: string;
};
export type RsvpKind = 'going' | 'volunteer';
export type Role = 'admin' | 'organizer' | 'moderator' | null;

export const CATS: { key: Cat; label: string; emoji: string; pillar?: string; blurb?: string }[] = [
  { key: 'environmental', label: 'Environmental', emoji: '🌿', pillar: 'Environmental Well-Being', blurb: 'Cleanups, tree planting, trail care and nature outings that keep our shared spaces beautiful.' },
  { key: 'community', label: 'Community', emoji: '🤝', pillar: 'Community Support & Local Connection', blurb: 'Food and donation drives, care visits, potlucks and swaps that rebuild ties between neighbors.' },
  { key: 'wellness', label: 'Physical wellness', emoji: '🏃', pillar: 'Physical Wellness & Active Engagement', blurb: 'Walking and running groups, races, hikes and yoga that make movement accessible to everyone.' },
  { key: 'mental', label: 'Mental & emotional', emoji: '🧘', pillar: 'Mental & Emotional Well-Being', blurb: 'Meditation, sound baths, journaling circles and awareness campaigns that support emotional resilience.' },
  { key: 'arts', label: 'Arts & fun', emoji: '🎨' },
  { key: 'other', label: 'Other', emoji: '✨' },
];
export const CAT = Object.fromEntries(CATS.map((c) => [c.key, c])) as Record<Cat, (typeof CATS)[number]>;

export const TAGS: [string, string][] = [
  ['family', 'Family friendly'], ['kids', 'Kids'], ['teens', 'Teens'], ['seniors', 'Seniors'], ['outdoor', 'Outdoors'], ['indoor', 'Indoors'],
  ['accessible', 'Accessible'], ['pets', 'Pets welcome'], ['volunteer', 'Volunteering'], ['fitness', 'Fitness'], ['nature', 'Nature'],
  ['food', 'Food'], ['music', 'Music'], ['learning', 'Learning'], ['social', 'Social'], ['faith', 'Faith'],
];
export const TAG = Object.fromEntries(TAGS) as Record<string, string>;
export const COSTS: [PEvent['cost'], string][] = [['free', 'Free'], ['donation', 'By donation'], ['paid', 'Paid']];
export const COST = Object.fromEntries(COSTS) as Record<PEvent['cost'], string>;
export const WHENS: [string, string][] = [['upcoming', 'Upcoming'], ['today', 'Today'], ['weekend', 'This weekend'], ['week', 'Next 7 days'], ['month', 'Next 30 days']];
export const RADII: [number | null, string][] = [[null, 'Any distance'], [2, 'Within 2 mi'], [5, 'Within 5 mi'], [10, 'Within 10 mi'], [25, 'Within 25 mi']];
export const HOME = { lat: 39.2037, lng: -76.861, name: 'Columbia, MD' };

// Stripe Payment Links on The Phoenix Catalyst's own Stripe account. Empty hides the option.
// The Phoenix Catalyst's own donation pages (fill in from TPC's Stripe Payment Links and PayPal donate button)
export const DONATE_LINKS: Record<string, string> = { '10': '', '25': '', '50': '', '100': '', custom: 'https://donate.stripe.com/aFaeVe99a3Knew07Tpfbq00' };
export const PAYPAL_DONATE = '';

const FRIENDLY: Record<string, string> = {
  resume_too_big: 'That file is over 10 MB. Try a PDF version.',
  phoenix_applications_one_open: 'You already have an application waiting for review.',
  phoenix_application_closed: 'That application was already reviewed.',
  phoenix_tpc_claim: 'Only Phoenix Catalyst leaders can post events hosted by The Phoenix Catalyst. Remove that from the host, name or description.',
  duplicate_event: 'This event is already on the calendar. Open it from Explore instead of posting it again.',
  phoenix_rate_limited: 'You’ve added 20 events today. You can add more tomorrow.',
  phoenix_event_unavailable: 'This event is no longer available.',
  phoenix_volunteer_full: 'All volunteer spots are filled. You can still say you’re going.',
  phoenix_volunteer_tpc_only: 'Volunteer sign-ups are only for Phoenix Catalyst events.',
  phoenix_sign_in_required: 'Sign in first.',
  phoenix_user_not_found: 'No account has that username.',
  phoenix_cannot_change_own_role: 'Ask another admin to change your own role.',
  dragonfly_username_taken: 'That username is taken. Try another.',
  dragonfly_username_invalid: 'Usernames can’t have spaces. Use 3–30 letters, numbers, dots, dashes or underscores.',
  invalid_credentials: 'That username or password didn’t match.',
  email_already_registered: 'That email already has a Dragonfly account. Tap “I have an account” and sign in with it.',
};
export function errText(err: unknown): string {
  const m = (err as { message?: string })?.message || String(err || '');
  for (const k of Object.keys(FRIENDLY)) if (m.includes(k)) return FRIENDLY[k];
  if (/Invalid login credentials/i.test(m)) return FRIENDLY.invalid_credentials;
  if (/Email not confirmed/i.test(m)) return 'Confirm your email first. Check your inbox for the link.';
  if (/duplicate key|already exists/i.test(m)) return 'That’s already done.';
  if (/Network request failed|Failed to fetch/i.test(m)) return 'Can’t reach the server. Check your connection and try again.';
  return m || 'Something went wrong. Try again.';
}
