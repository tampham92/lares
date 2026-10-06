import type { OnboardingItem, OnboardingItemId, OnboardingView } from '@lares/shared';
import type { UserRow } from '../auth/twofactor.js';
import { db, getSetting, setSetting } from '../db/index.js';
import { getBackupSettings } from './backups.js';
import { getAllowlist } from './security.js';

/*
 * "Bắt đầu với Lares" checklist on the dashboard. Every item is computed from live server state
 * (nothing is ticked by hand). Dismissing is remembered per user; the dismissal records which
 * security items were done at that moment, and the card comes back if one of them is undone later
 * (allowlist cleared, 2FA turned off, panel domain removed).
 */

export interface OnboardingFacts {
  allowlist: boolean;
  twoFactor: boolean;
  panelDomain: boolean;
  firstSite: boolean;
  backups: boolean;
  cloudflare: boolean;
}

export interface OnboardingState {
  dismissedAt: string | null;
  /** Security items that were done when the card was dismissed. */
  securityDone: OnboardingItemId[];
}

const ITEMS: Array<{ id: OnboardingItemId; optional: boolean; security: boolean }> = [
  { id: 'allowlist', optional: false, security: true },
  { id: 'twoFactor', optional: false, security: true },
  { id: 'panelDomain', optional: false, security: true },
  { id: 'firstSite', optional: false, security: false },
  { id: 'backups', optional: false, security: false },
  { id: 'cloudflare', optional: true, security: false },
];

/** The view for these facts and the state to persist (a regression clears the dismissal). */
export function computeOnboarding(facts: OnboardingFacts, state: OnboardingState): { view: OnboardingView; state: OnboardingState } {
  const items: OnboardingItem[] = ITEMS.map((i) => ({ ...i, done: facts[i.id] }));
  const required = items.filter((i) => !i.optional);
  const regressed = !!state.dismissedAt && state.securityDone.some((id) => !facts[id]);
  const next: OnboardingState = regressed ? { dismissedAt: null, securityDone: [] } : state;
  return {
    view: { items, done: required.filter((i) => i.done).length, total: required.length, dismissed: !!next.dismissedAt, reappeared: regressed },
    state: next,
  };
}

export function dismissState(facts: OnboardingFacts, now = new Date()): OnboardingState {
  return { dismissedAt: now.toISOString(), securityDone: ITEMS.filter((i) => i.security && facts[i.id]).map((i) => i.id) };
}

/**
 * The Cloudflare DNS integration (another module) stores its settings under `cloudflareDns`.
 * Its shape is not ours to know: connected = an object holding a non-empty token-like value (or
 * `connected: true`), unless it says enabled/connected false. Missing = not connected.
 */
export function cloudflareConnected(value: unknown): boolean {
  if (typeof value === 'string') return value.trim() !== '';
  if (!value || typeof value !== 'object') return false;
  const o = value as Record<string, unknown>;
  if (o.enabled === false || o.connected === false) return false;
  if (o.connected === true) return true;
  return Object.entries(o).some(([k, v]) => /token/i.test(k) && typeof v === 'string' && v.trim() !== '');
}

function facts(user: UserRow): OnboardingFacts {
  const panelDomain = getSetting<{ domain?: string | null }>('panelDomain', {});
  return {
    allowlist: getAllowlist().length > 0,
    twoFactor: !!user.totp_secret_enc,
    panelDomain: !!panelDomain.domain,
    firstSite: !!db.prepare('SELECT 1 FROM sites LIMIT 1').get(),
    backups: getBackupSettings().enabled,
    cloudflare: cloudflareConnected(getSetting<unknown>('cloudflareDns', null)),
  };
}

const key = (userId: number) => `onboarding.${userId}`;
const readState = (userId: number): OnboardingState => ({ dismissedAt: null, securityDone: [], ...getSetting<Partial<OnboardingState>>(key(userId), {}) });

export function getOnboarding(user: UserRow): OnboardingView {
  const before = readState(user.id);
  const { view, state } = computeOnboarding(facts(user), before);
  if (state !== before) setSetting(key(user.id), state);
  return view;
}

export function dismissOnboarding(user: UserRow): OnboardingView {
  const f = facts(user);
  const state = dismissState(f);
  setSetting(key(user.id), state);
  return computeOnboarding(f, state).view;
}

export function restoreOnboarding(user: UserRow): OnboardingView {
  const state: OnboardingState = { dismissedAt: null, securityDone: [] };
  setSetting(key(user.id), state);
  return computeOnboarding(facts(user), state).view;
}
