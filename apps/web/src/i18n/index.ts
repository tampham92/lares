import { useSyncExternalStore } from 'react';
import { DEFAULT_LANG, normalizeLang, translate, type Lang, type MsgParams } from '@lares/shared';
import { EN } from './en';

const KEY = 'lares_lang';

/** Saved choice, else the browser's preferred languages, else Vietnamese. */
function detect(): Lang {
  try {
    const saved = normalizeLang(localStorage.getItem(KEY));
    if (saved) return saved;
  } catch {
    /* storage unavailable */
  }
  const prefs = typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]);
  for (const p of prefs) {
    const l = normalizeLang(p);
    if (l) return l;
  }
  return DEFAULT_LANG;
}

let lang: Lang = detect();
const listeners = new Set<() => void>();
if (typeof document !== 'undefined') document.documentElement.lang = lang;

export const getLang = (): Lang => lang;

export function setLang(next: Lang) {
  if (next === lang) return;
  lang = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* storage unavailable */
  }
  document.documentElement.lang = next;
  listeners.forEach((fn) => fn());
}

/** Re-renders when the language changes; LangRoot uses it to remount the app. */
export function useLang(): Lang {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getLang,
  );
}

/** Translates a Vietnamese source string (see @lares/shared i18n). */
export function t(msg: string, params?: MsgParams): string {
  return translate(lang === 'en' ? EN : null, msg, params);
}

/** BCP 47 locale for dates and numbers. */
export const locale = (): string => (lang === 'en' ? 'en-US' : 'vi-VN');
