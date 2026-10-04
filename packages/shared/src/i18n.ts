// ---------------------------------------------------------------------------
// i18n core shared by server & web.
//
// Messages are keyed by their Vietnamese source text (gettext style): code calls
// t('Không tìm thấy site {id}', { id }) and the English dictionary maps that exact
// text to 'Site {id} not found'. Vietnamese needs no dictionary, and a missing
// English entry falls back to the Vietnamese text instead of showing a key.
// ---------------------------------------------------------------------------

export const LANGS = ['vi', 'en'] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = 'vi';

/** Each language's name written in that language, for the language picker. */
export const LANG_LABELS: Record<Lang, string> = { vi: 'Tiếng Việt', en: 'English' };

export type Dict = Readonly<Record<string, string>>;
export type MsgParams = Readonly<Record<string, string | number>>;

/** 'en', 'en-US', 'EN_us.UTF-8' → 'en'; anything unsupported → null. */
export function normalizeLang(v: unknown): Lang | null {
  if (typeof v !== 'string') return null;
  const base = v.trim().toLowerCase().slice(0, 2);
  return (LANGS as readonly string[]).includes(base) ? (base as Lang) : null;
}

/**
 * Marks a constant (a label table, a status map) for translation without translating it
 * yet: the text stays Vietnamese in the constant and is passed through t() where shown.
 */
export const msg = (s: string): string => s;

/** Looks `msg` up in `dict` (null = source language) and fills {placeholders} from `params`. */
export function translate(dict: Dict | null, msg: string, params?: MsgParams): string {
  const s = dict?.[msg] ?? msg;
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (Object.hasOwn(params, k) ? String(params[k]) : m));
}
