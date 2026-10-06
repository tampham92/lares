import { useEffect, useRef, useState } from 'react';
import type { BuilderSpec } from '@lares/shared';
import { auth, post } from '../api';
import { Alert } from './ui';
import { t } from '../i18n';

/**
 * Live preview of a builder spec. The iframe is a sandboxed page served by the panel itself
 * (/api/builder/frame, no allow-same-origin); every change is rendered by the server and posted
 * into it, which swaps the document in place and keeps the scroll position.
 */
export function BuilderPreview({ spec, device = 'desktop', full = false }: { spec: BuilderSpec; device?: 'desktop' | 'mobile'; full?: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const ready = useRef(false);
  const latest = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const push = () => {
    if (ready.current && latest.current) frame.current?.contentWindow?.postMessage({ type: 'lares-preview', html: latest.current }, '*');
  };

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      setBusy(true);
      post<{ html: string }>('/api/builder/render', { spec })
        .then((r) => {
          if (cancelled) return;
          latest.current = r.html;
          setError(null);
          push();
        })
        .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : String(err)))
        .finally(() => !cancelled && setBusy(false));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [spec]);

  return (
    <div className={`bld-frame ${device === 'mobile' ? 'mobile' : ''} ${full ? 'full' : ''}`}>
      {error && <Alert tone="warn">{t('Chưa cập nhật được bản xem trước: {error}', { error })}</Alert>}
      <iframe
        ref={frame}
        title={t('Xem trước website')}
        sandbox="allow-scripts"
        src={`/api/builder/frame?token=${encodeURIComponent(auth.token ?? '')}`}
        aria-busy={busy}
        onLoad={() => {
          // the frame fires load again after each swap - only the first one means "listener ready"
          if (ready.current) return;
          ready.current = true;
          push();
        }}
      />
    </div>
  );
}
