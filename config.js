// Public client settings. The publishable key is safe to ship: row-level security protects the data.
export const SUPABASE_URL = 'https://fkksaivdznqbfsfsagsj.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_ME6Xg1mtUBA4994aC0n6Uw_LKsJDTXu';
export const CALENDAR_FN = `${SUPABASE_URL}/functions/v1/phoenix-calendar`;
export const USERNAME_LOGIN_FN = `${SUPABASE_URL}/functions/v1/dragonfly-username-login`;

// Stripe Payment Links on The Phoenix Catalyst's own Stripe account.
// Leave a value empty to hide that option. "custom" should be a link that lets donors choose the amount.
export const DONATE_LINKS = {
  10: '',
  25: '',
  50: '',
  100: '',
  custom: 'https://donate.stripe.com/aFaeVe99a3Knew07Tpfbq00',
};

// The Phoenix Catalyst's PayPal donate link (a PayPal donate button link or paypal.me). Empty hides it.
export const PAYPAL_DONATE = '';

// Default map center when the viewer hasn't shared location (Columbia, MD).
export const HOME = { lat: 39.2037, lng: -76.8610, name: 'Columbia, MD' };

// Year-end campaign banner ("Bring Color Back"). OFF until the owner approves the name and goal and turns it on.
// goal_cents is the single goal setting the banner reads. progress_url must be a Phoenix-only endpoint
// (https, path containing /phoenix) that returns { ledger: 'phoenix', campaign, raised_cents, donors };
// leave it empty and the banner shows without numbers.
export const CAMPAIGN = {
  enabled: false,
  id: 'bring-color-back-2026',
  starts_at: '2026-12-01T00:00:00-05:00',
  ends_at: '2026-12-31T23:59:59-05:00',
  goal_cents: 500000,
  progress_url: '',
  copy: {
    title: 'Bring Color Back',
    line: 'Help us find our first 75 supporters by Dec 31.',
    button: 'Give to Bring Color Back',
    small: 'Any amount from $5. The calendar stays free either way.',
    empty: 'Be our first supporter.',
    after: 'Thank you. {count} neighbors raised {raised} in December.',
  },
};
