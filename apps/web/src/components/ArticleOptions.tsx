import type { ReactNode } from 'react';
import { ARTICLE_TONES, LANG_LABELS, msg, type ArticleTone, type Lang } from '@lares/shared';
import { t } from '../i18n';
import { Check, Field } from './ui';

const LENGTHS = [
  [800, msg('Ngắn (~800 từ)')],
  [1200, msg('Vừa (~1.200 từ)')],
  [1800, msg('Dài (~1.800 từ)')],
  [2500, msg('Chuyên sâu (~2.500 từ)')],
] as const;

/** Form state of the article settings shared by "write now" and the schedules (empty string = not set). */
export interface ArticleOptionsValue {
  words: number;
  tone: ArticleTone;
  language: Lang;
  audience: string;
  instructions: string;
  includeFaq: boolean;
}

/** Length, tone, language, audience, extra instructions and FAQ. `children` lead the grid row. */
export function ArticleOptions({ value: v, onChange, children }: { value: ArticleOptionsValue; onChange: (v: ArticleOptionsValue) => void; children?: ReactNode }) {
  return (
    <>
      <div className="form-grid">
        {children}
        <Field label={t('Độ dài')}>
          <select value={v.words} onChange={(e) => onChange({ ...v, words: Number(e.target.value) })}>
            {LENGTHS.map(([n, l]) => (
              <option key={n} value={n}>
                {t(l)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Giọng văn')}>
          <select value={v.tone} onChange={(e) => onChange({ ...v, tone: e.target.value as ArticleTone })}>
            {Object.entries(ARTICLE_TONES).map(([k, l]) => (
              <option key={k} value={k}>
                {t(l)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Ngôn ngữ')}>
          <select value={v.language} onChange={(e) => onChange({ ...v, language: e.target.value as Lang })}>
            <option value="vi">{LANG_LABELS.vi}</option>
            <option value="en">{LANG_LABELS.en}</option>
          </select>
        </Field>
        <Field label={t('Độc giả mục tiêu (tuỳ chọn)')}>
          <input value={v.audience} onChange={(e) => onChange({ ...v, audience: e.target.value })} placeholder={t('Người đi làm 25–35 tuổi ở TP.HCM')} />
        </Field>
      </div>
      <Field label={t('Yêu cầu thêm (tuỳ chọn)')} hint={t('Ý chính cần có, thông tin về sản phẩm/dịch vụ của bạn, điều cần tránh...')}>
        <textarea value={v.instructions} onChange={(e) => onChange({ ...v, instructions: e.target.value })} rows={3} className="prose-input" />
      </Field>
      <Check checked={v.includeFaq} onChange={(includeFaq) => onChange({ ...v, includeFaq })}>
        {t('Thêm mục Câu hỏi thường gặp (FAQ)')}
      </Check>
    </>
  );
}

/** The API shape: optional texts are left out when empty. */
export const articleOptionsPayload = (v: ArticleOptionsValue) => ({ ...v, audience: v.audience.trim() || undefined, instructions: v.instructions.trim() || undefined });

/** "a, b ,, c" -> ["a", "b", "c"] */
export const splitKeywords = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
