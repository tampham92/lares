import { LANG_LABELS, LANGS, type Lang } from '@lares/shared';
import { setLang, t, useLang } from '.';

export function LanguageSwitcher({ className }: { className?: string }) {
  const lang = useLang();
  return (
    <select className={className} value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label={t('Ngôn ngữ')}>
      {LANGS.map((l) => (
        <option key={l} value={l}>
          {LANG_LABELS[l]}
        </option>
      ))}
    </select>
  );
}
