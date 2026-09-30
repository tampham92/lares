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
