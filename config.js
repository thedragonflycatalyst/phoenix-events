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
