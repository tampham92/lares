/**
 * Admin CLI, installed as /usr/local/bin/lares by install.sh:
 *   lares users                          list panel accounts
 *   lares reset-password [user] [--password X]   set a new password (random if omitted)
 *   lares has-user <user>                exit 0 if the account exists (used by install.sh)
 *   lares disable-2fa [user]             turn off two-factor auth (lost phone + recovery codes)
 *   lares allowlist show|add <ip/cidr>|remove <ip/cidr>|clear   panel IP allowlist
 */
import bcrypt from 'bcryptjs';
import { db } from './db/index.js';
import { t } from './i18n/index.js';
import { clearFailures } from './auth/lockout.js';
import { bumpTokenVersion, disableTwoFactor } from './auth/twofactor.js';
import { randomPassword } from './lib/crypto.js';
import { getAllowlist, normalizeAllowlist, setAllowlist } from './services/security.js';

interface UserRow {
  id: number;
  username: string;
  created_at: string;
}

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest.splice(i, 2)[1] : undefined;
};

function main(): number {
  switch (cmd) {
    case 'users': {
      const rows = db.prepare('SELECT id, username, created_at FROM users ORDER BY id').all() as UserRow[];
      if (!rows.length) console.log(t('(chưa có tài khoản - sẽ được tạo khi Lares khởi động)'));
      for (const r of rows) console.log(`${r.id}\t${r.username}\t${r.created_at}`);
      return 0;
    }
    case 'has-user': {
      const name = rest[0] ?? 'admin';
      return db.prepare('SELECT 1 FROM users WHERE username = ?').get(name) ? 0 : 1;
    }
    case 'reset-password': {
      const given = flag('--password');
      const username = rest[0] ?? 'admin';
      if (given !== undefined && given.length < 10) {
        console.error(t('Mật khẩu tối thiểu 10 ký tự'));
        return 1;
      }
      const password = given ?? randomPassword(16);
      const hash = bcrypt.hashSync(password, 12);
      const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: number } | undefined;
      if (existing) {
        db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(hash, username);
        bumpTokenVersion(existing.id); // the old password may be compromised: sign out every session
      } else db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);
      clearFailures(username);
      console.log(
        existing
          ? t('Đã đặt lại mật khẩu cho "{user}": {password}', { user: username, password })
          : t('Đã tạo mật khẩu cho "{user}": {password}', { user: username, password }),
      );
      return 0;
    }
    case 'disable-2fa': {
      const username = rest[0] ?? 'admin';
      const row = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: number } | undefined;
      if (!row) {
        console.error(t('Không có tài khoản "{user}"', { user: username }));
        return 1;
      }
      disableTwoFactor(row.id);
      clearFailures(username);
      console.log(t('Đã tắt xác thực hai lớp cho "{user}"', { user: username }));
      return 0;
    }
    case 'allowlist':
      return allowlist(rest[0], rest[1]);
    default:
      console.log(
        `${t('Cách dùng:')}\n  lares users\n  lares reset-password [user] [--password <${t('mật khẩu')}>]\n  lares disable-2fa [user]\n  lares allowlist show|add <ip/cidr>|remove <ip/cidr>|clear`,
      );
      return cmd ? 1 : 0;
  }
}

function allowlist(action = 'show', entry?: string): number {
  try {
    const list = getAllowlist();
    switch (action) {
      case 'show':
        if (!list.length) console.log(t('(trống - mọi IP đều vào được trang đăng nhập)'));
        for (const e of list) console.log(e);
        return 0;
      case 'add':
      case 'remove': {
        if (!entry) {
          console.error(`${t('Cách dùng:')} lares allowlist ${action} <ip/cidr>`);
          return 1;
        }
        const [norm] = normalizeAllowlist([entry]);
        const next = setAllowlist(action === 'add' ? [...list, norm!] : list.filter((e) => e !== norm));
        console.log(next.length ? next.join('\n') : t('(trống - mọi IP đều vào được trang đăng nhập)'));
        return 0;
      }
      case 'clear':
        setAllowlist([]);
        console.log(t('Đã xoá danh sách IP được phép - mọi IP đều vào được trang đăng nhập'));
        return 0;
      default:
        console.error(`${t('Cách dùng:')} lares allowlist show|add <ip/cidr>|remove <ip/cidr>|clear`);
        return 1;
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

process.exitCode = main();
