import { AsyncLocalStorage } from 'node:async_hooks';
import { DEFAULT_LANG, normalizeLang, translate, type Lang, type MsgParams } from '@lares/shared';
import { EN } from './en/index.js';

/**
 * Language of the work in progress. Each API request runs inside its own store
 * (see langHook), so errors and task logs come back in the language the web UI
 * asked for, including background tasks a request started. Outside a request
 * (startup, CLI, timers) the panel default applies: LARES_LANG, else Vietnamese.
 */
const store = new AsyncLocalStorage<Lang>();

export const defaultLang: Lang = normalizeLang(process.env.LARES_LANG ?? process.env.TPANEL_LANG) ?? DEFAULT_LANG;

export const currentLang = (): Lang => store.getStore() ?? defaultLang;

export function t(msg: string, params?: MsgParams): string {
  return translate(currentLang() === 'en' ? EN : null, msg, params);
}

/**
 * For text written onto a customer's site (placeholder pages, the suspended page, the
 * quick-login plugin): always the panel default language, so the site does not change
 * language depending on who last triggered a rebuild.
 */
export function tDefault(msg: string, params?: MsgParams): string {
  return translate(defaultLang === 'en' ? EN : null, msg, params);
}

export function runWithLang<T>(lang: Lang, fn: () => T): T {
  return store.run(lang, fn);
}

/** X-Lares-Lang header, then ?lang= (EventSource cannot send headers), then Accept-Language. */
export function requestLang(headers: Record<string, string | string[] | undefined>, query: unknown): Lang {
  const header = headers['x-lares-lang'];
  const q = (query as { lang?: unknown } | undefined)?.lang;
  const accept = headers['accept-language'];
  return (
    normalizeLang(Array.isArray(header) ? header[0] : header) ??
    normalizeLang(q) ??
    normalizeLang(typeof accept === 'string' ? accept.split(',')[0] : undefined) ??
    defaultLang
  );
}
