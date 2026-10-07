import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { sameGithubRepo, type GithubRepo } from '@lares/shared';
import { errMsg, get } from '../api';
import { t } from '../i18n';
import { useGithub } from './GithubAppCard';
import { Field } from './ui';

const MANUAL = '__manual';

/**
 * Repo + branch fields of a Next.js site, rendered inside the parent's `.form-grid`. With GitHub
 * connected they are pickers fed by the GitHub App; otherwise (or on "Other Git URL") the plain
 * Git URL / Branch inputs plus the caller's access-token field.
 */
export function GitSourceFields({
  gitUrl,
  branch,
  onChange,
  tokenField,
  keepTokenField = false,
}: {
  gitUrl: string;
  branch: string;
  onChange: (v: { gitUrl: string; branch: string }) => void;
  tokenField: ReactNode;
  /** Show the token field with the picker too (a token is already saved and can be removed). */
  keepTokenField?: boolean;
}) {
  const gh = useGithub();
  const ready = !!gh.data?.connected && gh.data.installations.length > 0;
  const repos = useQuery({ queryKey: ['github-repos'], queryFn: () => get<GithubRepo[]>('/api/github/repos'), enabled: ready, staleTime: 60_000 });
  const selected = repos.data?.find((r) => sameGithubRepo(r.cloneUrl, gitUrl)) ?? null;
  const [manual, setManual] = useState(false);
  const picker = ready && !repos.isError && !manual && (!!selected || !gitUrl);
  const branches = useQuery({
    queryKey: ['github-branches', selected?.fullName],
    queryFn: () => get<string[]>(`/api/github/branches?repo=${encodeURIComponent(selected!.fullName)}`),
    enabled: picker && !!selected,
    staleTime: 60_000,
  });

  const branchField = (
    <Field label="Branch">
      {picker && selected && branches.data ? (
        <select value={branch} onChange={(e) => onChange({ gitUrl, branch: e.target.value })}>
          {[...new Set([branch, ...branches.data])].map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      ) : (
        <input value={branch} onChange={(e) => onChange({ gitUrl, branch: e.target.value })} />
      )}
    </Field>
  );

  if (!picker) {
    const backToGithub = ready && !repos.isError && (
      <>
        {' · '}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setManual(false);
            onChange({ gitUrl: '', branch });
          }}
        >
          {t('Chọn repo từ GitHub')}
        </a>
      </>
    );
    // Without a usable GitHub connection, say how to get the picker: connect, or install the App.
    let suggestion: ReactNode = null;
    if (gh.data && !gh.data.connected) {
      suggestion = (
        <>
          {t('Repo trên GitHub?')} <Link to="/settings?tab=integrations">{t('Kết nối GitHub')}</Link> {t('để chọn repo (kể cả private) mà không cần token')}
        </>
      );
    } else if (gh.data?.app && !ready && !gh.data.lastError) {
      suggestion = (
        <>
          <a href={gh.data.app.installUrl} target="_blank" rel="noreferrer">
            {t('Cài GitHub App')}
          </a>{' '}
          {t('để chọn repo từ danh sách')}
        </>
      );
    }
    return (
      <>
        {suggestion && <div className="hint span-all">{suggestion}</div>}
        <Field
          label="Git URL"
          hint={
            repos.isError ? (
              t('Không tải được danh sách repo từ GitHub: {error}', { error: errMsg(repos.error) })
            ) : (
              <>
                {t('https://github.com/org/repo.git hoặc git@...')}
                {backToGithub}
              </>
            )
          }
        >
          <input value={gitUrl} onChange={(e) => onChange({ gitUrl: e.target.value, branch })} />
        </Field>
        {tokenField}
        {branchField}
      </>
    );
  }

  return (
    <>
      <Field
        label={t('Repo GitHub')}
        hint={
          <>
            {t('Không thấy repo?')}{' '}
            <a href={gh.data!.app!.installUrl} target="_blank" rel="noreferrer">
              {t('Cấp thêm quyền cho GitHub App')}
            </a>
          </>
        }
      >
        <select
          value={selected?.fullName ?? ''}
          disabled={repos.isLoading}
          onChange={(e) => {
            if (e.target.value === MANUAL) {
              setManual(true);
              onChange({ gitUrl: '', branch });
              return;
            }
            const r = repos.data?.find((x) => x.fullName === e.target.value);
            onChange(r ? { gitUrl: r.cloneUrl, branch: r.defaultBranch } : { gitUrl: '', branch });
          }}
        >
          <option value="">{repos.isLoading ? t('Đang tải danh sách repo…') : t('— Chọn repo —')}</option>
          {repos.data?.map((r) => (
            <option key={r.fullName} value={r.fullName}>
              {r.private ? `${r.fullName} (private)` : r.fullName}
            </option>
          ))}
          <option value={MANUAL}>{t('Git URL khác…')}</option>
        </select>
      </Field>
      {keepTokenField && tokenField}
      {branchField}
    </>
  );
}
