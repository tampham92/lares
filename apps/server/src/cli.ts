/**
 * Admin CLI, installed as /usr/local/bin/lares by install.sh:
 *   lares users                          list panel accounts
 *   lares reset-password [user] [--password X]   set a new password (random if omitted)
 *   lares has-user <user>                exit 0 if the account exists (used by install.sh)
 */
import bcrypt from 'bcryptjs';
import { db } from './db/index.js';
import { t } from './i18n/index.js';
import { randomPassword } from './lib/crypto.js';

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
      const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (existing) db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(hash, username);
      else db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);
      console.log(
        existing
          ? t('Đã đặt lại mật khẩu cho "{user}": {password}', { user: username, password })
          : t('Đã tạo mật khẩu cho "{user}": {password}', { user: username, password }),
      );
      return 0;
    }
    default:
      console.log(`${t('Cách dùng:')}\n  lares users\n  lares reset-password [user] [--password <${t('mật khẩu')}>]`);
      return cmd ? 1 : 0;
  }
}

process.exitCode = main();
