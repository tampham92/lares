import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  AppType,
  MigrationItem,
  MigrationItemInput,
  MigrationLog,
  MigrationOptions,
  MigrationStepId,
  Site,
  SourceInput,
} from '@tpanel/shared';
import { config } from '../config.js';
import { nowIso } from '../db/index.js';
import { localExecutor, type Executor } from '../executors/index.js';
import { randomSuffix, sha256File } from '../lib/crypto.js';
import { errorMessage } from '../lib/errors.js';
import { duKb, shq, tarCreate, tarExcludes } from '../lib/shell.js';
import { UndoStack } from '../lib/undo.js';
import * as databases from '../services/databases.js';
import { host } from '../services/host.js';
import * as mysql from '../services/mysql.js';
import { port80Owner } from '../services/nginx.js';
import * as nodeapp from '../services/nodeapp.js';
import * as sites from '../services/sites.js';
import { rewriteWpConfig, wpCliAsWebUser } from '../services/wordpress.js';
import { rewriteDotEnv } from './appDetect.js';
import * as repo from './repo.js';
import { detectTools, freeBytes, mysqldumpFlags, openSource, sourceMysqlIdentity, writeSourceMyCnf, type SourceSession } from './source.js';

type TransferKind = 'local' | 'archive' | 'stream';

interface RunContext {
  migrationId: number;
  source: SourceInput;
  session: SourceSession;
  options: MigrationOptions;
  signal: AbortSignal;
  compressor: 'pigz' | 'gzip';
  dumpFlags: string[];
  hasSha256: boolean;
}

interface ItemContext {
  run: RunContext;
  item: MigrationItem;
  input: MigrationItemInput;
  ex: Executor;
  undo: UndoStack;
  transfer: TransferKind;
  /** Staging dir on the TPanel host. */
  localDir: string;
  /** Work dir on the source (archive mode only). */
  remoteDir: string;
  remoteCnf: string | null;
  appType: AppType;
  excludes: string[];
  remoteHashes: Record<string, string>;
  dbDump: string | null;
  filesArchive: string | null;
  site: Site | null;
  targetDb: { name: string; user: string; password: string; host: string } | null;
}

class Cancelled extends Error {
  constructor() {
    super('Đã huỷ bởi người dùng');
  }
}

const REMOTE_PREFIX = 'tpanel-migrate-';
const NEXT_EXCLUDES = ['node_modules', '.next'];

const fmtBytes = (n: number) => {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
};

export class MigrationRunner {
  private active = new Map<number, AbortController>();

  isRunning(id: number) {
    return this.active.has(id);
  }

  start(migrationId: number) {
    if (this.active.has(migrationId)) throw new Error('Migration đang chạy');
    const ac = new AbortController();
    this.active.set(migrationId, ac);
    void this.run(migrationId, ac.signal).finally(() => this.active.delete(migrationId));
  }

  cancel(migrationId: number): boolean {
    const ac = this.active.get(migrationId);
    if (!ac) return false;
    ac.abort();
    return true;
  }

  private log(migrationId: number, itemId: number | null, level: MigrationLog['level'], message: string) {
    repo.addLog(migrationId, itemId, level, message);
  }

  private async run(migrationId: number, signal: AbortSignal) {
    const m = repo.getMigration(migrationId);
    repo.updateMigration(migrationId, { status: 'running', startedAt: m.startedAt ?? nowIso(), finishedAt: null, error: null });
    const source = repo.getSourceInput(migrationId);
    let session: SourceSession | null = null;
    try {
      this.log(migrationId, null, 'info', `Kết nối tới nguồn ${m.sourceLabel}...`);
      session = await openSource(source);
      if (session.sameHost) this.log(migrationId, null, 'info', `Nguồn chạy chung máy với TPanel: ${session.sameHostReason ?? ''}`);
      repo.updateMigration(migrationId, { sameHost: session.sameHost });

      const tools = await detectTools(session.ex);
      const ctx: RunContext = {
        migrationId,
        source,
        session,
        options: m.options,
        signal,
        compressor: tools.pigz ? 'pigz' : 'gzip',
        dumpFlags: tools.mysqldump ? await mysqldumpFlags(session.ex) : [],
        hasSha256: tools.sha256sum,
      };
      this.log(migrationId, null, 'debug', `Công cụ nén: ${ctx.compressor}; mysqldump: ${tools.mysqldump ? 'có' : 'không'}`);

      for (const item of (m.items ?? []).filter((i) => i.status === 'pending')) {
        if (signal.aborted) {
          repo.saveItem({ ...item, status: 'cancelled', error: 'Đã huỷ' });
          continue;
        }
        await this.runItem(ctx, item);
      }
    } catch (err) {
      this.log(migrationId, null, 'error', errorMessage(err));
      repo.updateMigration(migrationId, { error: errorMessage(err) });
      for (const it of repo.getMigration(migrationId).items ?? []) {
        if (it.status === 'pending') repo.saveItem({ ...it, status: 'failed', error: errorMessage(err) });
      }
    } finally {
      await session?.close().catch(() => {});
    }

    const items = repo.getMigration(migrationId).items ?? [];
    const done = items.filter((i) => i.status === 'completed').length;
    const status = signal.aborted ? 'cancelled' : done === items.length ? 'completed' : done > 0 ? 'partial' : 'failed';
    repo.updateMigration(migrationId, { status, finishedAt: nowIso() });
    this.log(migrationId, null, status === 'completed' ? 'info' : 'warn', `Kết thúc: ${done}/${items.length} site thành công`);
  }

  // -------------------------------------------------------------------------
  // Per-site pipeline
  // -------------------------------------------------------------------------

  private async runItem(run: RunContext, initial: MigrationItem) {
    const input = repo.getItemInput(initial.id);
    const item: MigrationItem = { ...initial, status: 'running', steps: repo.initialSteps(), notes: [], error: null };
    const appType: AppType = input.appType === 'unknown' ? 'php' : input.appType;
    const excludes = [...input.excludes];
    if (appType === 'nextjs') for (const e of NEXT_EXCLUDES) if (!excludes.includes(e)) excludes.push(e);

    const ctx: ItemContext = {
      run,
      item,
      input,
      ex: run.session.ex,
      undo: new UndoStack(),
      transfer: 'archive',
      localDir: path.join(config.stagingDir, `${run.migrationId}-${item.id}`),
      remoteDir: '',
      remoteCnf: null,
      appType,
      excludes,
      remoteHashes: {},
      dbDump: null,
      filesArchive: null,
      site: null,
      targetDb: null,
    };
    repo.saveItem(item);
    const log = (level: MigrationLog['level'], msg: string) => this.log(run.migrationId, item.id, level, `[${input.targetDomain}] ${msg}`);
    log('info', `Bắt đầu chuyển ${input.sourceDomain} (${input.sourceRoot}) → ${input.targetDomain}`);

    try {
      await this.step(ctx, 'prepare', () => this.prepare(ctx, log));
      await this.step(ctx, 'dump_db', () => this.dumpDb(ctx, log));
      await this.step(ctx, 'archive_files', () => this.archiveFiles(ctx, log));
      await this.step(ctx, 'transfer', () => this.transferFiles(ctx, log));
      await this.step(ctx, 'verify', () => this.verify(ctx, log));
      await this.step(ctx, 'create_site', () => this.createSite(ctx, log));
      await this.step(ctx, 'restore_files', () => this.restoreFiles(ctx, log));
      await this.step(ctx, 'restore_db', () => this.restoreDb(ctx, log));
      await this.step(ctx, 'configure', () => this.configure(ctx, log));
      await this.step(ctx, 'finalize', () => this.finalize(ctx, log));
      await this.step(ctx, 'cleanup', () => this.cleanup(ctx, log, true));
      item.status = 'completed';
      item.currentStep = null;
      repo.saveItem(item);
      log('info', 'Hoàn tất ✔');
    } catch (err) {
      const cancelled = err instanceof Cancelled || run.signal.aborted;
      item.status = cancelled ? 'cancelled' : 'failed';
      item.error = errorMessage(err);
      log('error', `Thất bại: ${item.error}`);
      if (run.options.rollbackOnFailure) {
        log('warn', 'Đang rollback các thay đổi trên TPanel...');
        await ctx.undo.run((m) => log('warn', m));
        item.siteId = null;
      } else if (ctx.site) {
        item.notes.push(`Site ${ctx.site.domain} được giữ lại để kiểm tra (rollback đã tắt)`);
      }
      await this.cleanup(ctx, log, false).catch(() => {});
      repo.saveItem(item);
    }
  }

  private async step(ctx: ItemContext, id: MigrationStepId, fn: () => Promise<string | void | { skip: string }>) {
    if (ctx.run.signal.aborted) throw new Cancelled();
    const { item } = ctx;
    item.currentStep = id;
    item.steps[id] = { status: 'running', startedAt: nowIso() };
    repo.saveItem(item);
    try {
      const r = await fn();
      if (ctx.run.signal.aborted) throw new Cancelled();
      const skipped = typeof r === 'object' && r !== null && 'skip' in r;
      item.steps[id] = {
        ...item.steps[id],
        status: skipped ? 'skipped' : 'done',
        detail: skipped ? r.skip : (r ?? undefined),
        progress: skipped ? undefined : 1,
        finishedAt: nowIso(),
      };
    } catch (err) {
      item.steps[id] = { ...item.steps[id], status: 'failed', detail: errorMessage(err), finishedAt: nowIso() };
      repo.saveItem(item);
      throw ctx.run.signal.aborted ? new Cancelled() : err;
    }
    repo.saveItem(item);
  }

  /** Throttled progress update for long transfers. */
  private progress(ctx: ItemContext, id: MigrationStepId) {
    let last = 0;
    return (fraction: number | null, detail: string) => {
      const now = Date.now();
      if (now - last < 700) return;
      last = now;
      ctx.item.steps[id] = { ...ctx.item.steps[id], status: 'running', progress: fraction ?? undefined, detail };
      repo.saveItem(ctx.item);
    };
  }

  // -------------------------------------------------------------------------

  private async prepare(ctx: ItemContext, log: (l: MigrationLog['level'], m: string) => void) {
    const { input, ex, run } = ctx;
    if ((await ex.exec(`test -d ${shq(input.sourceRoot)}`)).code !== 0) throw new Error(`Không tìm thấy thư mục nguồn ${input.sourceRoot}`);
    const existing = sites.findSiteByHostname(input.targetDomain);
    if (existing) throw new Error(`${input.targetDomain} đã tồn tại trên TPanel (site #${existing.id}). Xoá site đó hoặc đổi tên miền đích.`);
    for (const a of input.aliases) {
      const owner = sites.findSiteByHostname(a);
      if (owner) throw new Error(`Alias ${a} đang thuộc site ${owner.domain}`);
    }

    const sizeKb = Number((await ex.exec(duKb(input.sourceRoot))).stdout.trim()) || 0;
    const size = sizeKb * 1024;
    log('info', `Dung lượng mã nguồn: ${fmtBytes(size)}`);

    // --- transfer mode
    if (run.session.sameHost) {
      ctx.transfer = 'local';
    } else {
      const mode = run.options.transferMode;
      const bases = ['/var/tmp', '/tmp'];
      let best: { dir: string; free: number } | null = null;
      for (const d of bases) {
        const free = await freeBytes(ex, d);
        if (free !== null && (!best || free > best.free)) best = { dir: d, free };
      }
      const enoughSpace = best !== null && best.free > size * 1.2 + 512 * 1024 * 1024;
      ctx.transfer = mode === 'stream' ? 'stream' : mode === 'archive' ? 'archive' : enoughSpace ? 'archive' : 'stream';
      if (mode === 'archive' && !enoughSpace) log('warn', `VPS nguồn có thể không đủ chỗ trống để nén (${best ? fmtBytes(best.free) : '?'} trống)`);
      if (mode === 'auto' && !enoughSpace) log('info', 'VPS nguồn ít dung lượng trống → dùng chế độ stream (nén và truyền trực tiếp qua SSH)');
      ctx.remoteDir = `${best?.dir ?? '/var/tmp'}/${REMOTE_PREFIX}${run.migrationId}-${ctx.item.id}-${randomSuffix(6)}`;
    }

    await fs.mkdir(ctx.localDir, { recursive: true, mode: 0o700 });
    const localFree = await freeBytes(localExecutor, config.stagingDir).catch(() => null);
    if (localFree !== null && ctx.transfer !== 'local' && localFree < size * 2) {
      log('warn', `Dung lượng trống trên TPanel (${fmtBytes(localFree)}) có thể không đủ cho ${fmtBytes(size)} dữ liệu`);
    }

    const needsWorkDir = ctx.transfer !== 'local' || input.db.strategy !== 'skip';
    if (needsWorkDir && !ctx.remoteDir) ctx.remoteDir = path.join(config.stagingDir, `${run.migrationId}-${ctx.item.id}-src`);
    if (needsWorkDir) await ex.run(`mkdir -p ${shq(ctx.remoteDir)} && chmod 700 ${shq(ctx.remoteDir)}`);

    // --- database
    if (ctx.appType === 'nextjs' || ctx.appType === 'static') {
      if (input.db.strategy !== 'skip') log('info', `${ctx.appType} không dùng MySQL → bỏ qua database`);
      input.db.strategy = 'skip';
    }
    if (input.db.strategy !== 'skip') {
      const creds = input.db.source;
      if (!creds) throw new Error('Thiếu thông tin database nguồn (nhập tay hoặc chọn "Không chuyển database")');
      ctx.remoteCnf = `${ctx.remoteDir}/.my.cnf`;
      await writeSourceMyCnf(ex, ctx.remoteCnf, creds);
      const test = await ex.exec(`mysql --defaults-extra-file=${shq(ctx.remoteCnf)} -N -B -e 'SELECT 1' ${shq(creds.name)}`);
      if (test.code !== 0) throw new Error(`Không đăng nhập được database nguồn ${creds.name}: ${test.stderr.trim().split('\n').pop()}`);

      if (input.db.strategy === 'reuse') {
        if (!run.session.sameHost) throw new Error('Chỉ dùng lại database khi panel nguồn chạy chung VPS với TPanel');
        const [src, dst] = await Promise.all([sourceMysqlIdentity(ex, ctx.remoteCnf), mysql.serverIdentity()]);
        if (!config.dryRun && (!src || !dst || src !== dst)) {
          throw new Error('Database nguồn nằm trên MySQL server khác với MySQL của TPanel → không thể dùng lại, hãy chọn "Import sang database mới"');
        }
        log('info', `Dùng lại database ${creds.name} trên cùng MySQL server (không copy dữ liệu)`);
      }
    }

    return `${fmtBytes(size)} · chế độ ${ctx.transfer === 'local' ? 'cùng máy (copy trực tiếp)' : ctx.transfer === 'archive' ? 'nén trên nguồn + SFTP' : 'stream qua SSH'}`;
  }

  private dumpCommand(ctx: ItemContext, withRoutines: boolean) {
    const creds = ctx.input.db.source!;
    const flags = [...ctx.run.dumpFlags, ...(withRoutines ? ['--routines'] : [])].join(' ');
    return `mysqldump --defaults-extra-file=${shq(ctx.remoteCnf!)} ${flags} ${shq(creds.name)} | ${ctx.run.compressor} -c -6`;
  }

  private async dumpDb(ctx: ItemContext, log: (l: MigrationLog['level'], m: string) => void) {
    if (ctx.input.db.strategy !== 'import') return { skip: ctx.input.db.strategy === 'reuse' ? 'Dùng lại database hiện có' : 'Không chuyển database' };
    const { ex, run } = ctx;
    const progress = this.progress(ctx, 'dump_db');
    const localFile = path.join(ctx.localDir, 'db.sql.gz');

    const attempt = async (withRoutines: boolean) => {
      const dump = this.dumpCommand(ctx, withRoutines);
      if (ctx.transfer === 'stream') {
        await ex.execToFile(dump, localFile, { signal: run.signal, onProgress: (b) => progress(null, `Đã nhận ${fmtBytes(b)}`) });
        ctx.dbDump = localFile;
      } else {
        const target = ctx.transfer === 'local' ? localFile : `${ctx.remoteDir}/db.sql.gz`;
        await ex.run(`${dump} > ${shq(target)}`, { signal: run.signal, timeoutMs: 6 * 3_600_000 });
        ctx.dbDump = target;
      }
    };

    try {
      await attempt(true);
    } catch (err) {
      // Site users frequently lack the privilege to dump stored routines; the data itself matters more.
      if (!/routine|PROCEDURE|FUNCTION|privilege|Access denied/i.test(errorMessage(err))) throw err;
      log('warn', 'User database không có quyền dump routines → dump lại không kèm stored procedures');
      await attempt(false);
    }

    const size =
      ctx.transfer === 'archive' ? Number((await ex.run(`stat -c %s ${shq(ctx.dbDump!)}`)).trim()) : (await fs.stat(ctx.dbDump!)).size;
    if (ctx.transfer === 'archive' && run.hasSha256) {
      ctx.remoteHashes.db = (await ex.run(`sha256sum ${shq(ctx.dbDump!)} | cut -d' ' -f1`)).trim();
    }
    log('info', `Đã dump database ${ctx.input.db.source!.name} (${fmtBytes(size || 0)} nén)`);
    return `${ctx.input.db.source!.name} · ${fmtBytes(size || 0)}`;
  }

  private async archiveFiles(ctx: ItemContext, log: (l: MigrationLog['level'], m: string) => void) {
    if (ctx.transfer === 'local') return { skip: 'Cùng máy chủ: sao chép trực tiếp, không cần nén' };
    const { ex, run, input } = ctx;
    const cmd = `${tarCreate(input.sourceRoot, tarExcludes(ctx.excludes))} | ${run.compressor} -c -6`;
    const progress = this.progress(ctx, 'archive_files');
    if (ctx.excludes.length) log('info', `Loại trừ: ${ctx.excludes.join(', ')}`);

    if (ctx.transfer === 'stream') {
      const local = path.join(ctx.localDir, 'files.tar.gz');
      await ex.execToFile(cmd, local, { signal: run.signal, onProgress: (b) => progress(null, `Đang nén & truyền: ${fmtBytes(b)}`) });
      ctx.filesArchive = local;
      const size = (await fs.stat(local)).size;
      log('info', `Đã nén và nhận mã nguồn qua SSH (${fmtBytes(size)})`);
      return `${fmtBytes(size)} (stream)`;
    }

    const remote = `${ctx.remoteDir}/files.tar.gz`;
    await ex.run(`${cmd} > ${shq(remote)}`, { signal: run.signal, timeoutMs: 12 * 3_600_000 });
    ctx.filesArchive = remote;
    if (run.hasSha256) ctx.remoteHashes.files = (await ex.run(`sha256sum ${shq(remote)} | cut -d' ' -f1`)).trim();
    const size = Number((await ex.run(`stat -c %s ${shq(remote)}`)).trim());
    const c = run.source.connection;
    if (c.mode === 'ssh' && c.useSudo && c.username !== 'root') {
      // archives were created as root via sudo; SFTP runs as the login user
      await ex.run(`chown ${shq(c.username)} ${shq(ctx.remoteDir)} ${shq(ctx.remoteDir)}/*.gz`);
    }
    log('info', `Đã nén mã nguồn trên VPS nguồn (${fmtBytes(size)})`);
    return fmtBytes(size);
  }

  private async transferFiles(ctx: ItemContext, log: (l: MigrationLog['level'], m: string) => void) {
    if (ctx.transfer !== 'archive') return { skip: ctx.transfer === 'local' ? 'Cùng máy chủ' : 'Đã truyền trong lúc nén (stream)' };
    const progress = this.progress(ctx, 'transfer');
    const pairs: Array<[keyof ItemContext & ('dbDump' | 'filesArchive'), string]> = [];
    if (ctx.dbDump) pairs.push(['dbDump', path.join(ctx.localDir, 'db.sql.gz')]);
    if (ctx.filesArchive) pairs.push(['filesArchive', path.join(ctx.localDir, 'files.tar.gz')]);
    const started = Date.now();
    let total = 0;
    for (const [key, local] of pairs) {
      const remote = ctx[key]!;
      await ctx.ex.download(remote, local, {
        signal: ctx.run.signal,
        onProgress: (done, size) => {
          const speed = done / Math.max(1, (Date.now() - started) / 1000);
          progress(size ? done / size : null, `${path.basename(local)}: ${fmtBytes(done)} / ${fmtBytes(size)} · ${fmtBytes(speed)}/s`);
        },
      });
      total += (await fs.stat(local)).size;
      ctx[key] = local;
    }
    const secs = Math.max(1, (Date.now() - started) / 1000);
    log('info', `Đã đồng bộ ${fmtBytes(total)} về TPanel trong ${secs.toFixed(0)}s (${fmtBytes(total / secs)}/s)`);
    return `${fmtBytes(total)} · ${fmtBytes(total / secs)}/s`;
  }

  private async verify(ctx: ItemContext, log: (l: MigrationLog['level'], m: string) => void) {
    const checks: string[] = [];
    for (const [key, file] of [
      ['db', ctx.dbDump],
      ['files', ctx.filesArchive],
    ] as const) {
      if (!file) continue;
      const expected = ctx.remoteHashes[key];
      if (expected) {
        const actual = await sha256File(file);
        if (actual !== expected) throw new Error(`Checksum ${path.basename(file)} không khớp (nguồn ${expected.slice(0, 12)}…, nhận ${actual.slice(0, 12)}…)`);
        checks.push(`${path.basename(file)} sha256 ✔`);
      }
      const gz = await host.exec(`gzip -t ${shq(file)}`);
      if (gz.code !== 0) throw new Error(`${path.basename(file)} bị hỏng: ${gz.stderr.trim()}`);
      if (key === 'db') {
        const tail = await host.exec(`gzip -cd ${shq(file)} | tail -c 300`);
        if (!tail.stdout.includes('Dump completed')) throw new Error('File dump database không hoàn chỉnh (thiếu dòng "Dump completed")');
      }
      checks.push(`${path.basename(file)} gzip ✔`);
    }
    if (!checks.length) return { skip: 'Không có file nén để kiểm tra' };
    log('info', `Kiểm tra toàn vẹn: ${checks.join(', ')}`);
    return checks.join(', ');
  }

  private async createSite(ctx: ItemContext, log: (l: MigrationLog['level'], m: string) => void) {
    const { input } = ctx;
    const nodeConfig: nodeapp.NodeAppConfig | undefined =
      ctx.appType === 'nextjs' ? { packageManager: 'auto', env: {}, ...(input.nextjs ?? {}) } : undefined;
    ctx.site = await sites.provisionSite(
      {
        domain: input.targetDomain,
        aliases: input.aliases,
        appType: ctx.appType,
        phpVersion: input.phpVersion,
        webRootSubdir: input.webRootSubdir,
        migrationId: ctx.run.migrationId,
        nodeConfig,
        allowExistingDir: input.overwrite,
      },
      (m) => log('info', m),
      ctx.undo,
    );
    ctx.item.siteId = ctx.site.id;
    if (ctx.appType === 'nextjs') {
      ctx.undo.push('xoá service Next.js', () => nodeapp.removeService(input.targetDomain));
    }
    return `Site #${ctx.site.id}${ctx.site.appPort ? ` · port ${ctx.site.appPort}` : ''}${ctx.site.phpVersion ? ` · PHP ${ctx.site.phpVersion}` : ''}`;
  }

  private async restoreFiles(ctx: ItemContext, log: (l: MigrationLog['level'], m: string) => void) {
    const { input, run } = ctx;
    const dest = sites.siteLayout(input.targetDomain, ctx.appType).appDir;
    await fs.mkdir(dest, { recursive: true });
    if (ctx.transfer === 'local') {
      if (path.resolve(input.sourceRoot) === path.resolve(dest)) throw new Error('Thư mục nguồn trùng thư mục đích');
      await host.run(`${tarCreate(input.sourceRoot, tarExcludes(ctx.excludes))} | tar -C ${shq(dest)} -xpf -`, { signal: run.signal, timeoutMs: 12 * 3_600_000 });
      log('info', `Đã copy trực tiếp ${input.sourceRoot} → ${dest}`);
    } else {
      await host.run(`tar -xzf ${shq(ctx.filesArchive!)} --no-same-owner -C ${shq(dest)}`, { signal: run.signal, timeoutMs: 12 * 3_600_000 });
      log('info', `Đã giải nén mã nguồn vào ${dest}`);
    }

    // Config kept outside the web root on the source (Webinoly: /var/www/site/wp-config.php)
    if (input.configPath && !input.configPath.startsWith(input.sourceRoot + '/')) {
      const content = await ctx.ex.readFile(input.configPath);
      if (content === null) throw new Error(`Không đọc được ${input.configPath}`);
      await host.writeFile(path.join(dest, path.basename(input.configPath)), content, 0o640);
      log('info', `Đã chuyển ${input.configPath} vào thư mục site`);
    }
    return dest;
  }

  private async restoreDb(ctx: ItemContext, log: (l: MigrationLog['level'], m: string) => void) {
    const { input } = ctx;
    const src = input.db.source;
    if (input.db.strategy === 'skip' || !src) return { skip: 'Không có database' };
    if (input.db.strategy === 'reuse') {
      databases.registerExternalDatabase(src.name, src.user, src.password, ctx.site!.id);
      return { skip: `Dùng lại ${src.name}` };
    }
    const name = databases.deriveDbName(input.targetDomain);
    const created = await databases.createDatabase({ name, username: name, siteId: ctx.site!.id }, (m) => log('info', m));
    ctx.undo.push(`xoá database ${name}`, () => databases.deleteDatabase(created.record.id));
    ctx.targetDb = { name, user: name, password: created.password, host: 'localhost' };
    log('info', `Đang import database vào ${name}...`);
    const started = Date.now();
    await mysql.importGzipDump(name, ctx.dbDump!, { user: name, password: created.password }, { signal: ctx.run.signal, log: (m) => log('debug', m) });
    log('info', `Đã import database ${src.name} → ${name} (${((Date.now() - started) / 1000).toFixed(0)}s)`);
    ctx.item.notes.push(`Database mới: ${name} / user ${name} (mật khẩu xem tại mục Database)`);
    return `${src.name} → ${name}`;
  }

  private async configure(ctx: ItemContext, log: (l: MigrationLog['level'], m: string) => void) {
    const { input } = ctx;
    const site = ctx.site!;
    const appDir = sites.siteLayout(site.domain, ctx.appType).appDir;
    const changes: string[] = [];
    const domainChanged = input.sourceDomain !== input.targetDomain;

    if (ctx.appType === 'wordpress') {
      const cfgFile = path.join(appDir, 'wp-config.php');
      if (ctx.targetDb && (await host.exists(cfgFile))) {
        const src = await fs.readFile(cfgFile, 'utf8');
        await host.writeFile(cfgFile, rewriteWpConfig(src, ctx.targetDb), 0o640);
        changes.push('wp-config.php: cập nhật DB_*');
      }
      if (domainChanged && input.searchReplace) {
        if (input.db.strategy === 'reuse') {
          ctx.item.notes.push('Không search-replace tên miền vì database đang dùng chung với site nguồn');
        } else if (input.db.strategy === 'import') {
          await this.wordpressSearchReplace(ctx, appDir, log);
          changes.push(`search-replace ${input.sourceDomain} → ${input.targetDomain}`);
        }
      }
    }

    if (ctx.appType === 'laravel' || ctx.appType === 'php') {
      const envFile = path.join(appDir, '.env');
      if (await host.exists(envFile)) {
        const values: Record<string, string> = {};
        if (ctx.targetDb) Object.assign(values, { DB_HOST: '127.0.0.1', DB_PORT: '3306', DB_DATABASE: ctx.targetDb.name, DB_USERNAME: ctx.targetDb.user, DB_PASSWORD: ctx.targetDb.password });
        const src = await fs.readFile(envFile, 'utf8');
        if (domainChanged) {
          const appUrl = src.match(/^APP_URL=(.*)$/m)?.[1];
          if (appUrl?.includes(input.sourceDomain)) values.APP_URL = appUrl.split(input.sourceDomain).join(input.targetDomain);
        }
        if (Object.keys(values).length) {
          await host.writeFile(envFile, rewriteDotEnv(src, values), 0o640);
          changes.push(`.env: ${Object.keys(values).join(', ')}`);
        }
      }
      if (ctx.appType === 'laravel' && (await host.has('php'))) {
        await sites.fixPermissions(site.rootPath);
        await host.mutate(host.asWebUser('php artisan config:clear && php artisan cache:clear', { cwd: appDir, home: site.rootPath }), { log: (m) => log('debug', m) }).catch((err) =>
          log('warn', `artisan: ${errorMessage(err)}`),
        );
      }
    }

    if (ctx.appType === 'nextjs') {
      log('info', 'Cài dependencies & build Next.js (có thể mất vài phút)...');
      const cfg = sites.getNodeConfig(site.id);
      await nodeapp.buildAndRestart({ ...site, appPort: site.appPort! }, cfg, (m) => log('debug', m), ctx.run.signal);
      changes.push(`build & chạy service ${nodeapp.serviceName(site.domain)} (port ${site.appPort})`);
      ctx.item.notes.push('Next.js: biến môi trường bí mật không nằm trong mã nguồn (vd. .env.production) cần được khai báo lại trong phần cấu hình site');
    }

    if (!changes.length) return { skip: 'Không cần thay đổi cấu hình' };
    for (const c of changes) log('info', c);
    return changes.join(' · ');
  }

  private async wordpressSearchReplace(ctx: ItemContext, appDir: string, log: (l: MigrationLog['level'], m: string) => void) {
    const { input } = ctx;
    const from = input.sourceDomain;
    const to = input.targetDomain;
    if (await host.has('wp')) {
      // wp-cli handles serialized PHP arrays correctly - plain SQL REPLACE would corrupt them
      await sites.fixPermissions(ctx.site!.rootPath);
      const args = `search-replace ${shq(`//${from}`)} ${shq(`//${to}`)} --all-tables-with-prefix --skip-columns=guid --precise --report-changed-only`;
      await host.mutate(wpCliAsWebUser(appDir, ctx.site!.rootPath, args), {
        log: (m) => log('debug', m),
        timeoutMs: 3_600_000,
      });
      return;
    }
    const prefix = input.db.source?.prefix ?? 'wp_';
    if (!/^[A-Za-z0-9_]+$/.test(prefix)) throw new Error(`Table prefix không hợp lệ: ${prefix}`);
    log('warn', 'Không có wp-cli → chỉ cập nhật siteurl/home. Nên cài wp-cli để search-replace toàn bộ nội dung.');
    await mysql.query(
      `UPDATE \`${ctx.targetDb!.name}\`.\`${prefix}options\` SET option_value = REPLACE(option_value, ?, ?) WHERE option_name IN ('siteurl', 'home')`,
      [`//${from}`, `//${to}`],
    );
  }

  private async finalize(ctx: ItemContext, log: (l: MigrationLog['level'], m: string) => void) {
    const site = sites.getSite(ctx.site!.id);
    await sites.fixPermissions(site.rootPath, (m) => log('debug', m));
    await sites.applySiteVhost(site, (m) => log('debug', m));
    if (ctx.run.session.sameHost) {
      const owner = await port80Owner();
      if (owner && owner !== 'nginx') ctx.item.notes.push(`Port 80 vẫn do "${owner}" giữ - dừng web server của panel cũ để TPanel phục vụ ${site.domain}`);
      else ctx.item.notes.push(`Site cũ vẫn còn trên panel nguồn. Nếu cùng dùng nginx, hãy tắt vhost ${ctx.input.sourceDomain} ở panel cũ để tránh trùng server_name.`);
    } else {
      ctx.item.notes.push(`Trỏ DNS ${[site.domain, ...site.aliases].join(', ')} về IP máy chủ TPanel, sau đó cài SSL cho site`);
    }
    return 'Đã áp dụng quyền & vhost';
  }

  private async cleanup(ctx: ItemContext, log: (l: MigrationLog['level'], m: string) => void, success: boolean) {
    const done: string[] = [];
    // Credentials file always goes, even when keeping archives.
    if (ctx.remoteCnf) await ctx.ex.exec(`rm -f ${shq(ctx.remoteCnf)}`);
    const safeRemote = ctx.remoteDir && (path.basename(ctx.remoteDir).startsWith(REMOTE_PREFIX) || ctx.remoteDir.startsWith(config.stagingDir));
    if (safeRemote && (ctx.run.options.cleanupSource || !success)) {
      await ctx.ex.exec(`rm -rf ${shq(ctx.remoteDir)}`);
      done.push('file tạm trên nguồn');
    }
    if (!ctx.run.options.keepLocalArchives || !success) {
      await fs.rm(ctx.localDir, { recursive: true, force: true });
      done.push('file tạm trên TPanel');
    } else {
      ctx.item.notes.push(`Giữ file nén tại ${ctx.localDir}`);
    }
    if (success && done.length) log('info', `Đã dọn ${done.join(', ')}`);
    return done.length ? `Đã xoá ${done.join(', ')}` : { skip: 'Giữ lại file tạm' };
  }
}

export const runner = new MigrationRunner();

