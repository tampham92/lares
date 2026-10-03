/** Quote a string for safe interpolation into a POSIX shell command. */
export function shq(value: string | number): string {
  const s = String(value);
  if (s.includes('\0')) throw new Error('Refusing to quote string containing NUL byte');
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Build `cmd arg1 arg2...` with every argument quoted. */
export function cmd(bin: string, ...args: Array<string | number | false | null | undefined>): string {
  return [bin, ...args.filter((a): a is string | number => a !== false && a !== null && a !== undefined).map(shq)].join(' ');
}

/**
 * `tar -cf - .` of a live site. GNU tar exits 1 when files change while being read, which is fine for a
 * running site; the flag and the tolerance only apply to GNU tar (BSD tar uses exit 1 for real errors).
 */
export function tarCreate(root: string, excludes: string): string {
  return `( if tar --version 2>/dev/null | grep -q GNU; then tar --warning=no-file-changed -C ${shq(root)} ${excludes} -cf - .; rc=$?; [ $rc -eq 1 ] && exit 0; exit $rc; else tar -C ${shq(root)} ${excludes} -cf - .; fi )`;
}

/** `--exclude` flags for tarCreate: patterns are relative to the archived root. */
export function tarExcludes(patterns: string[]): string {
  return patterns
    .map((p) => p.replace(/^\.?\/+/, '').replace(/\/+$/, ''))
    .filter(Boolean)
    .map((p) => `--exclude=${shq(p.startsWith('*') ? p : `./${p}`)}`)
    .join(' ');
}

/** Size of a directory in KiB (prints nothing when it cannot be measured within 2 minutes). */
export const duKb = (dir: string) =>
  `{ if command -v timeout >/dev/null 2>&1; then timeout 120 du -sk ${shq(dir)}; else du -sk ${shq(dir)}; fi; } 2>/dev/null | cut -f1`;
