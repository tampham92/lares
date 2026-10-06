import { useState } from 'react';
import type { LeadChannel, NotifyConfigInput, NotifyConfigView, TelegramChat } from '@lares/shared';
import { errMsg, post } from '../api';
import { t } from '../i18n';
import { Alert, Check, Field } from './ui';

/** Editable copy of a notification config. Secrets start empty: empty = keep the stored one. */
export interface NotifyForm {
  telegram: { enabled: boolean; botToken: string; chatId: string; clearBotToken: boolean };
  webhook: { enabled: boolean; url: string; secretHeader: string; secret: string; clearSecret: boolean };
}

export const notifyFormFrom = (v: NotifyConfigView): NotifyForm => ({
  telegram: { enabled: v.telegram.enabled, botToken: '', chatId: v.telegram.chatId, clearBotToken: false },
  webhook: { enabled: v.webhook.enabled, url: v.webhook.url, secretHeader: v.webhook.secretHeader || 'X-Lares-Secret', secret: '', clearSecret: false },
});

export const notifyInput = (f: NotifyForm): NotifyConfigInput => ({
  telegram: { enabled: f.telegram.enabled, botToken: f.telegram.botToken || undefined, clearBotToken: f.telegram.clearBotToken || undefined, chatId: f.telegram.chatId },
  webhook: { enabled: f.webhook.enabled, url: f.webhook.url, secretHeader: f.webhook.secretHeader, secret: f.webhook.secret || undefined, clearSecret: f.webhook.clearSecret || undefined },
});

type Msg = { tone: 'ok' | 'err'; text: string } | null;

/** Telegram + webhook settings with "Gửi thử", "Tìm chat ID" and setup help. Used by Settings and the site tab. */
export function LeadNotifyFields({ view, form, onChange, siteId }: { view: NotifyConfigView; form: NotifyForm; onChange: (f: NotifyForm) => void; siteId?: number }) {
  const [msg, setMsg] = useState<Record<LeadChannel, Msg>>({ telegram: null, webhook: null });
  const [busy, setBusy] = useState<string | null>(null);
  const [chats, setChats] = useState<TelegramChat[] | null>(null);
  const tg = form.telegram;
  const wh = form.webhook;
  const setTg = (p: Partial<NotifyForm['telegram']>) => onChange({ ...form, telegram: { ...tg, ...p } });
  const setWh = (p: Partial<NotifyForm['webhook']>) => onChange({ ...form, webhook: { ...wh, ...p } });
  const tokenStored = view.telegram.hasToken && !tg.clearBotToken;
  const secretStored = view.webhook.hasSecret && !wh.clearSecret;

  const run = async (key: string, channel: LeadChannel, fn: () => Promise<string | null>) => {
    setBusy(key);
    setMsg((m) => ({ ...m, [channel]: null }));
    try {
      const text = await fn();
      if (text) setMsg((m) => ({ ...m, [channel]: { tone: 'ok', text } }));
    } catch (e) {
      setMsg((m) => ({ ...m, [channel]: { tone: 'err', text: errMsg(e) } }));
    } finally {
      setBusy(null);
    }
  };

  const test = (channel: LeadChannel) =>
    run(`test-${channel}`, channel, async () => {
      const input = notifyInput(form);
      return (await post<{ message: string }>('/api/leads/notify-test', { channel, siteId, telegram: input.telegram, webhook: input.webhook })).message;
    });

  const findChats = () =>
    run('chats', 'telegram', async () => {
      const r = await post<{ chats: TelegramChat[] }>('/api/leads/telegram/chats', { siteId, botToken: tg.botToken || undefined });
      setChats(r.chats);
      return r.chats.length ? null : t('Chưa có ai nhắn cho bot. Mở chat với bot, bấm Start (hoặc gửi một tin trong nhóm có bot), rồi bấm lại "Tìm chat ID".');
    });

  return (
    <>
      <h3>Telegram</h3>
      <Check checked={tg.enabled} onChange={(v) => setTg({ enabled: v })}>
        {t('Gửi thông báo qua Telegram')}
      </Check>
      <details>
        <summary>{t('Cách tạo bot và lấy chat ID')}</summary>
        <ol className="lead-help">
          <li>{t('Trong Telegram, mở @BotFather, gửi /newbot, đặt tên cho bot. BotFather trả về bot token dạng 123456789:ABC...')}</li>
          <li>{t('Mở chat với bot vừa tạo và bấm Start. Muốn cả nhóm cùng nhận: thêm bot vào nhóm rồi gửi một tin bất kỳ trong nhóm.')}</li>
          <li>{t('Dán token vào ô bên dưới, bấm "Tìm chat ID" và chọn đúng cuộc trò chuyện (chat cá nhân là số dương, nhóm là số âm như -100...).')}</li>
          <li>{t('Bấm "Gửi thử" để kiểm tra, rồi bấm Lưu.')}</li>
        </ol>
      </details>
      <div className="form-grid">
        <Field
          label="Bot token"
          hint={
            tokenStored ? (
              <>
                {t('Đã lưu:')} <code>{view.telegram.tokenHint}</code> — {t('để trống để giữ nguyên.')}{' '}
                <button type="button" className="btn ghost sm" onClick={() => setTg({ clearBotToken: true, botToken: '', enabled: false })}>
                  {t('Xoá token')}
                </button>
              </>
            ) : tg.clearBotToken ? (
              t('Token sẽ bị xoá khi bấm Lưu.')
            ) : undefined
          }
        >
          <input type="password" autoComplete="off" value={tg.botToken} onChange={(e) => setTg({ botToken: e.target.value.trim(), clearBotToken: false })} placeholder={tokenStored ? t('•••••••• (đã lưu)') : '123456789:ABC...'} />
        </Field>
        <Field label="Chat ID">
          <input value={tg.chatId} onChange={(e) => setTg({ chatId: e.target.value.trim() })} placeholder="123456789" />
        </Field>
      </div>
      {chats && chats.length > 0 && (
        <div className="stack lead-chats">
          <div className="hint">{t('Chọn cuộc trò chuyện nhận thông báo:')}</div>
          <div className="row">
            {chats.map((c) => (
              <button key={c.id} type="button" className={`btn sm${tg.chatId === c.id ? ' primary' : ''}`} onClick={() => setTg({ chatId: c.id })} title={c.type}>
                {c.title} <span className="mono">{c.id}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {msg.telegram && <Alert tone={msg.telegram.tone}>{msg.telegram.text}</Alert>}
      <div className="row">
        <button type="button" className="btn sm" disabled={busy !== null || (!tg.botToken && !tokenStored)} onClick={findChats}>
          {t('Tìm chat ID')}
        </button>
        <button type="button" className="btn sm" disabled={busy !== null || (!tg.botToken && !tokenStored) || !tg.chatId} onClick={() => test('telegram')}>
          {busy === 'test-telegram' ? t('Đang gửi…') : t('Gửi thử')}
        </button>
      </div>

      <h3>Webhook</h3>
      <Check checked={wh.enabled} onChange={(v) => setWh({ enabled: v })}>
        {t('Gửi dữ liệu tới webhook (POST JSON)')}
      </Check>
      <div className="hint">{t('Mỗi khách liên hệ mới được gửi dạng JSON tới URL bạn nhập. Dùng với Make, n8n, Zapier hoặc Google Apps Script để ghi vào Google Sheets, gửi email, chuyển sang Zalo...')}</div>
      <Field label={t('URL webhook')}>
        <input type="url" value={wh.url} onChange={(e) => setWh({ url: e.target.value.trim() })} placeholder="https://hook.eu1.make.com/..." />
      </Field>
      <div className="form-grid">
        <Field label={t('Header bí mật (tuỳ chọn)')} hint={t('Bên nhận kiểm tra header này để chắc chắn dữ liệu đến từ Lares')}>
          <input value={wh.secretHeader} onChange={(e) => setWh({ secretHeader: e.target.value.trim() })} placeholder="X-Lares-Secret" />
        </Field>
        <Field
          label={t('Giá trị bí mật')}
          hint={
            secretStored ? (
              <>
                {t('Đã lưu - để trống để giữ nguyên.')}{' '}
                <button type="button" className="btn ghost sm" onClick={() => setWh({ clearSecret: true, secret: '' })}>
                  {t('Xoá')}
                </button>
              </>
            ) : wh.clearSecret ? (
              t('Giá trị bí mật sẽ bị xoá khi bấm Lưu.')
            ) : undefined
          }
        >
          <input type="password" autoComplete="off" value={wh.secret} onChange={(e) => setWh({ secret: e.target.value, clearSecret: false })} placeholder={secretStored ? t('•••••••• (đã lưu)') : ''} />
        </Field>
      </div>
      <details>
        <summary>{t('Dữ liệu gửi đi và ví dụ Google Sheets')}</summary>
        <div className="stack lead-details">
          <pre className="lead-code">{WEBHOOK_SAMPLE}</pre>
          <div className="hint">{t('Ghi thẳng vào Google Sheets không cần Make: mở bảng tính → Tiện ích mở rộng → Apps Script, dán đoạn mã dưới đây, bấm Triển khai → Ứng dụng web (quyền truy cập: Bất kỳ ai), rồi dán URL ứng dụng web vào ô URL webhook. Giữ URL này bí mật vì ai có nó đều ghi được vào bảng.')}</div>
          <pre className="lead-code">{APPS_SCRIPT}</pre>
        </div>
      </details>
      {msg.webhook && <Alert tone={msg.webhook.tone}>{msg.webhook.text}</Alert>}
      <div className="row">
        <button type="button" className="btn sm" disabled={busy !== null || !wh.url} onClick={() => test('webhook')}>
          {busy === 'test-webhook' ? t('Đang gửi…') : t('Gửi thử')}
        </button>
      </div>

      <h3>Zalo</h3>
      <Alert tone="info">
        {t('Lares chưa gửi trực tiếp qua Zalo. Zalo không có bot miễn phí như Telegram: API Zalo Official Account (OA) cần một OA đã xác thực, access token phải làm mới định kỳ, và OA chỉ nhắn được cho người đã quan tâm (follow) và tương tác với OA gần đây. Cách nên dùng: bật Webhook ở trên, nối vào Make hoặc n8n rồi gọi API Zalo OA từ đó; hoặc nhận thông báo qua Telegram.')}
      </Alert>
    </>
  );
}

const WEBHOOK_SAMPLE = `POST <URL webhook>
Content-Type: application/json
X-Lares-Event: lead.created
X-Lares-Secret: <...>

{
  "event": "lead.created",
  "test": false,
  "lead": {
    "id": 42,
    "site": "example.com",
    "name": "...",
    "phone": "0909 123 456",
    "phoneTel": "+84909123456",
    "email": "...",
    "company": "",
    "service": "...",
    "message": "...",
    "page": "/lien-he",
    "pageUrl": "https://example.com/lien-he",
    "createdAt": "2026-10-05T07:30:00.000Z"
  },
  "text": "..."
}`;

const APPS_SCRIPT = `function doPost(e) {
  var d = JSON.parse(e.postData.contents).lead;
  SpreadsheetApp.getActiveSheet().appendRow([
    d.createdAt, d.site, d.name, d.phone, d.email, d.service, d.message, d.pageUrl
  ]);
  return ContentService.createTextOutput('ok');
}`;
