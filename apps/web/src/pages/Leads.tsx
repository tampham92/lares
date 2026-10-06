import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { LeadSettingsView } from '@lares/shared';
import { get } from '../api';
import { LeadsInbox } from '../components/LeadsInbox';
import { t } from '../i18n';

/** "Khách liên hệ": contact-form leads from every managed site. */
export function Leads() {
  const settings = useQuery({ queryKey: ['lead-settings'], queryFn: () => get<LeadSettingsView>('/api/settings/leads') });
  const s = settings.data;
  const channels = s ? [s.telegram.enabled && 'Telegram', s.webhook.enabled && 'Webhook'].filter(Boolean).join(', ') : '';
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('Khách liên hệ')}</h1>
          <div className="sub">
            {t('Form liên hệ trên các website gửi về đây.')}{' '}
            {s && (s.retentionMonths ? t('Tự xoá sau {months} tháng.', { months: s.retentionMonths }) : t('Không tự xoá.'))}{' '}
            {s && (channels ? t('Thông báo qua: {channels}.', { channels }) : t('Chưa bật thông báo.'))}
          </div>
        </div>
        <div className="row">
          <Link className="btn" to="/settings">
            {t('Cài đặt thông báo')}
          </Link>
        </div>
      </div>
      <LeadsInbox />
    </>
  );
}
