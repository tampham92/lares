import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { DB_IDENT_RE } from '@tpanel/shared';
import { config } from '../config.js';
import { shq } from '../lib/shell.js';
import { host, type HostLogger } from './host.js';

let pool: mysql.Pool | null = null;

function getPool(): mysql.Pool {
  pool ??= mysql.createPool({
    ...(config.mysql.socketPath ? { socketPath: config.mysql.socketPath } : { host: config.mysql.host, port: config.mysql.port }),
    user: config.mysql.user,
    password: config.mysql.password,
    connectionLimit: 4,
    multipleStatements: false,
  });
  return pool;
}

function assertIdent(name: string, what = 'identifier') {
  if (!DB_IDENT_RE.test(name)) throw new Error(`${what} không hợp lệ: ${name}`);
}

export async function query<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
  if (config.dryRun) return [] as T;
  const [rows] = await getPool().query(sql, params);
  return rows as T;
}

export async function databaseExists(name: string): Promise<boolean> {
  if (config.dryRun) return false;
  const rows = await query<unknown[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [name]);
  return rows.length > 0;
}

export async function createDatabase(name: string, user: string, password: string, log?: HostLogger) {
  assertIdent(name, 'Tên database');
  assertIdent(user, 'Tên user');
  if (config.dryRun) {
    log?.(`[dry-run] CREATE DATABASE \`${name}\`; CREATE USER '${user}'@'localhost'; GRANT ALL`);
    return;
  }
  await query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await query(`CREATE USER IF NOT EXISTS ?@'localhost' IDENTIFIED BY ?`, [user, password]);
  await query(`ALTER USER ?@'localhost' IDENTIFIED BY ?`, [user, password]);
  await query(`GRANT ALL PRIVILEGES ON \`${name}\`.* TO ?@'localhost'`, [user]);
  await query('FLUSH PRIVILEGES');
}

export async function dropDatabase(name: string, user?: string, log?: HostLogger) {
  assertIdent(name, 'Tên database');
  if (config.dryRun) {
    log?.(`[dry-run] DROP DATABASE \`${name}\``);
    return;
  }
  await query(`DROP DATABASE IF EXISTS \`${name}\``);
  if (user) {
    assertIdent(user, 'Tên user');
    await query(`DROP USER IF EXISTS ?@'localhost'`, [user]);
  }
}

/** Identify the MySQL instance so we can tell when source and TPanel share the same server. */
export async function serverIdentity(): Promise<string | null> {
  if (config.dryRun) return null;
  try {
    const rows = await query<Array<Record<string, unknown>>>('SELECT @@hostname AS h, @@port AS p, @@datadir AS d');
    const r = rows[0];
    return r ? `${r.h}|${r.p}|${r.d}` : null;
  } catch {
    return null;
  }
}

/** Temp client option file so passwords never show up in `ps`. Defaults to the admin account. */
let cnfSeq = 0;
async function withDefaultsFile<T>(fn: (file: string) => Promise<T>, creds = { user: config.mysql.user, password: config.mysql.password }): Promise<T> {
  const file = path.join(config.dataDir, `.my-${process.pid}-${Date.now()}-${++cnfSeq}.cnf`);
  const lines = ['[client]', `user=${creds.user}`, `password="${creds.password.replace(/(["\\])/g, '\\$1')}"`];
  if (config.mysql.socketPath) lines.push(`socket=${config.mysql.socketPath}`);
  else lines.push(`host=${config.mysql.host}`, `port=${config.mysql.port}`);
  await fs.writeFile(file, lines.join('\n') + '\n', { mode: 0o600 });
  try {
    return await fn(file);
  } finally {
    await fs.rm(file, { force: true });
  }
}

/** Dumps are replayed as a site user: drop DEFINER clauses, map collations only MySQL 8 / MariaDB 11 know. */
const DUMP_FILTER = `sed -E ${[
  's/DEFINER=`[^`]+`@`[^`]+`//g',
  's/utf8mb4_0900_ai_ci/utf8mb4_unicode_ci/g',
  's/utf8mb4_uca1400_ai_ci/utf8mb4_unicode_ci/g',
]
  .map((e) => `-e ${shq(e)}`)
  .join(' ')}`;

/**
 * Import a gzipped dump. DEFINER clauses are stripped (the original definer user does not exist here)
 * and MySQL-8/MariaDB-11 only collations are mapped to utf8mb4_unicode_ci so dumps move between both engines.
 *
 * The dump comes from another server and is untrusted, so it is imported with the site's own
 * database user (privileges on this one database only) - never as root, where `USE other_db`
 * or `GRANT` statements inside the dump would reach the rest of the server.
 */
export async function importGzipDump(
  dbName: string,
  dumpFile: string,
  creds: { user: string; password: string },
  opts: { signal?: AbortSignal; log?: HostLogger } = {},
) {
  assertIdent(dbName, 'Tên database');
  if (config.dryRun) {
    opts.log?.(`[dry-run] gunzip -c ${dumpFile} | sed ... | mysql ${dbName}`);
    return;
  }
  await withDefaultsFile(
    (cnf) =>
      host.run(`gunzip -c ${shq(dumpFile)} | ${DUMP_FILTER} | mysql --defaults-extra-file=${shq(cnf)} --default-character-set=utf8mb4 ${shq(dbName)}`, {
        signal: opts.signal,
      }),
    creds,
  );
}

/**
 * Copy a database of this server into another one (site cloning): dumped with the admin account,
 * replayed with the target's own user, as with importGzipDump. Routines are dropped when the
 * target user may not create them (binary logging without log_bin_trust_function_creators).
 */
export async function copyDatabase(
  src: string,
  dst: string,
  dstCreds: { user: string; password: string },
  dumpFlags: string[],
  log?: HostLogger,
) {
  assertIdent(src, 'Tên database');
  assertIdent(dst, 'Tên database');
  if (config.dryRun) {
    log?.(`[dry-run] mysqldump ${src} | mysql ${dst}`);
    return;
  }
  const copy = (flags: string[]) =>
    withDefaultsFile((adminCnf) =>
      withDefaultsFile(
        (dstCnf) =>
          host.run(
            `mysqldump --defaults-extra-file=${shq(adminCnf)} ${flags.join(' ')} ${shq(src)} | ${DUMP_FILTER} | mysql --defaults-extra-file=${shq(dstCnf)} --default-character-set=utf8mb4 ${shq(dst)}`,
            { timeoutMs: 6 * 3_600_000 },
          ),
        dstCreds,
      ),
    );
  try {
    await copy([...dumpFlags, '--routines']);
  } catch (err) {
    if (!/routine|PROCEDURE|FUNCTION|SUPER|log_bin_trust/i.test(err instanceof Error ? err.message : String(err))) throw err;
    log?.('Không tạo được stored procedure/function trong database mới → sao chép lại không kèm routines');
    await copy(dumpFlags);
  }
}

export async function closeMysql() {
  await pool?.end();
  pool = null;
}
