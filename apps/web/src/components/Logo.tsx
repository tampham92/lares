import { useId } from 'react';

/**
 * The Lares mark: a house (Lares guarded the home) with the hearth flame in its doorway.
 * Same drawing as public/favicon.svg - keep both in sync. Colours are part of the mark on purpose.
 */
export function LogoMark({ size = 32 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo-mark">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6d65ff" />
          <stop offset="1" stopColor="#4338ca" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${id})`} />
      <path d="M7.5 15.2 16 8l8.5 7.2M10.6 13v11h10.8V13" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path
        transform="translate(0 -.7)"
        d="M16 16.4c1.9 1.8 2.8 3.2 2.8 4.8a2.8 2.8 0 0 1-5.6 0c0-1 .4-2 1.2-2.8.1.8.5 1.4 1.1 1.7-.2-1.2 0-2.5.5-3.7z"
        fill="#f59e0b"
      />
    </svg>
  );
}

/** Mark + wordmark. `tagline` adds "by ThoCode" under the name (login page). */
export function Logo({ size = 32, tagline = false }: { size?: number; tagline?: boolean }) {
  return (
    <div className="logo">
      <LogoMark size={size} />
      <div className="logo-text">
        <span className="logo-name">Lares</span>
        {tagline && <span className="logo-tagline">Panel by ThoCode</span>}
      </div>
    </div>
  );
}
