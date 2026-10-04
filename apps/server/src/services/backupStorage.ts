import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { BACKUP_ID_RE, type BackupManifest } from '@lares/shared';
import { backupDir, isInside, isSafeDomainSegment, parseManifest } from './backupPolicy.js';

export const MANIFEST_FILE = 'manifest.json';

export interface StoredBackup {
  id: string;
  /** null when manifest.json is missing or invalid (shown as damaged, can only be deleted). */
  manifest: BackupManifest | null;
}

/**
 * Where finished backups live. Jobs always build a backup in a local staging directory and hand
 * it to `commit`; restore asks for a local directory with `open`. A remote destination (S3, R2,
 * Google Drive...) implements the same calls - upload on commit, download on open - and the job
 * logic in backups.ts stays unchanged.
 */
export interface BackupStorage {
  readonly kind: string;
  /** Human-readable location, shown in the UI. */
  readonly location: string;
  /** Fresh local directory to write backup `id` of `domain` into. */
  prepare(domain: string, id: string): Promise<string>;
  /** Publish a complete staging directory. Until then the backup is invisible to `list`. */
  commit(domain: string, id: string, stagingDir: string): Promise<void>;
  /** Drop an unfinished staging directory. */
  discard(stagingDir: string): Promise<void>;
  list(domain: string): Promise<StoredBackup[]>;
  /** Local directory with the backup's files; call release() when done (remote: removes the download). */
  open(domain: string, id: string): Promise<{ dir: string; manifest: BackupManifest | null; release(): Promise<void> }>;
  /** The whole backup as one uncompressed tar stream (its parts are already gzipped). */
  download(domain: string, id: string): Promise<Readable>;
  remove(domain: string, id: string): Promise<void>;
}

const PARTIAL_PREFIX = '.partial-';

/** Backups kept on this VPS: <root>/<domain>/<id>/{manifest.json, files.tar.gz, db-*.sql.gz}, dirs 0700, files 0600. */
export class LocalBackupStorage implements BackupStorage {
  readonly kind = 'local';

  constructor(readonly root: string) {}

  get location() {
    return this.root;
  }

  private domainDir(domain: string) {
    if (!isSafeDomainSegment(domain)) throw new Error(`unsafe domain: ${domain}`);
    return path.join(this.root, domain);
  }

  /** The backup directory, refusing symlinks and anything that resolves outside the root. */
  private async existingDir(domain: string, id: string): Promise<string> {
    const dir = backupDir(this.root, domain, id);
    const st = await fs.lstat(dir);
    if (!st.isDirectory()) throw new Error(`not a backup directory: ${dir}`);
    const [realRoot, realDir] = await Promise.all([fs.realpath(this.root), fs.realpath(dir)]);
    if (!isInside(realRoot, realDir)) throw new Error(`backup directory escapes the backup root: ${dir}`);
    return dir;
  }

  async prepare(domain: string, id: string): Promise<string> {
    backupDir(this.root, domain, id); // validates domain + id
    const parent = this.domainDir(domain);
    await fs.mkdir(parent, { recursive: true, mode: 0o700 });
    await Promise.all([fs.chmod(this.root, 0o700), fs.chmod(parent, 0o700)]);
    const staging = path.join(parent, `${PARTIAL_PREFIX}${id}`);
    await fs.rm(staging, { recursive: true, force: true });
    await fs.mkdir(staging, { mode: 0o700 });
    return staging;
  }

  async commit(domain: string, id: string, stagingDir: string): Promise<void> {
    const dir = backupDir(this.root, domain, id);
    if (path.dirname(stagingDir) !== path.dirname(dir) || !path.basename(stagingDir).startsWith(PARTIAL_PREFIX)) throw new Error(`unexpected staging dir: ${stagingDir}`);
    await fs.rename(stagingDir, dir);
  }

  async discard(stagingDir: string): Promise<void> {
    if (!isInside(this.root, stagingDir) || !path.basename(stagingDir).startsWith(PARTIAL_PREFIX)) return;
    await fs.rm(stagingDir, { recursive: true, force: true });
  }

  async list(domain: string): Promise<StoredBackup[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.domainDir(domain));
    } catch {
      return [];
    }
    const out: StoredBackup[] = [];
    for (const id of names.filter((n) => BACKUP_ID_RE.test(n))) {
      const dir = backupDir(this.root, domain, id);
      const st = await fs.lstat(dir).catch(() => null);
      if (!st?.isDirectory()) continue;
      const text = await fs.readFile(path.join(dir, MANIFEST_FILE), 'utf8').catch(() => '');
      out.push({ id, manifest: parseManifest(text) });
    }
    return out.sort((a, b) => b.id.localeCompare(a.id, 'en', { numeric: true }));
  }

  async open(domain: string, id: string) {
    const dir = await this.existingDir(domain, id);
    const manifest = parseManifest(await fs.readFile(path.join(dir, MANIFEST_FILE), 'utf8').catch(() => ''));
    return { dir, manifest, release: async () => {} };
  }

  async download(domain: string, id: string): Promise<Readable> {
    const { dir, manifest } = await this.open(domain, id);
    if (!manifest) throw new Error('invalid manifest');
    const files = [MANIFEST_FILE, manifest.files.file, ...manifest.databases.map((d) => d.file)];
    // no shell: names come from the validated manifest and are passed as plain arguments
    const child = spawn('tar', ['-C', dir, '-cf', '-', '--', ...files], { stdio: ['ignore', 'pipe', 'ignore'] });
    child.on('error', (err) => child.stdout.destroy(err));
    child.on('close', (code) => {
      if (code !== 0) child.stdout.destroy(new Error(`tar exited with ${code}`));
    });
    return child.stdout;
  }

  async remove(domain: string, id: string): Promise<void> {
    await fs.rm(await this.existingDir(domain, id), { recursive: true, force: true });
  }

  /** Remove staging directories left behind by a crash (called at startup). */
  async cleanupPartials(): Promise<number> {
    let removed = 0;
    const domains = await fs.readdir(this.root).catch(() => [] as string[]);
    for (const domain of domains.filter(isSafeDomainSegment)) {
      const entries = await fs.readdir(path.join(this.root, domain)).catch(() => [] as string[]);
      for (const e of entries) {
        if (!e.startsWith(PARTIAL_PREFIX) || !BACKUP_ID_RE.test(e.slice(PARTIAL_PREFIX.length))) continue;
        await fs.rm(path.join(this.root, domain, e), { recursive: true, force: true });
        removed++;
      }
    }
    return removed;
  }
}
