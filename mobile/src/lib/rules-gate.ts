// Remembers that this person agreed to the current community rules (see rules.ts).
import { RULES_VERSION } from './rules';
import { recall, store } from './supabase';

const KEY = 'pe.rulesAccepted';
/** True once this device's person has agreed to the current rules. */
export function rulesAccepted(): boolean {
  return recall<number>(KEY, 0) >= RULES_VERSION;
}
export function acceptRules() { store(KEY, RULES_VERSION); }
