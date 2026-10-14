/**
 * One-click upgrade from Settings: runs the installer of the newest release tag, exactly like the
 * manual one-liner, but started by the panel.
 *
 * Trust is the same as the one-liner: install.sh comes from the release repository on GitHub. The
 * version is never taken from the request alone - it must be the release the last update check
 * found, newer than the running one - so the API cannot be used to install an arbitrary ref.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { compareVersions, type UpgradeStatus } from '@lares/shared';
import { config } from '../config.js';
import { getSetting, setSetting } from '../db/index.js';
import { conflict } from '../lib/errors.js';
import { t } from '../i18n/index.js';
import { host, type HostLogger } from './host.js';
import { releaseSettings, VERSION, versionInfo } from './release.js';
import { EXIT_MARKER, killedForMemory, UPGRADE_UNIT, upgradeCommand, upgradeStatus, type UpgradeMeta } from './upgradePolicy.js';

/** Root-only file next to the SQLite database; the installer writes to it from its own unit. */
const logFile = () => path.join(config.dataDir, 'upgrade.log');

async function unitActive(): Promise<boolean> {
  if (config.dryRun) return false;
  const r = await host.exec(`systemctl is-active --quiet ${UPGRADE_UNIT}`);
  return r.code === 0;
}

/** Runs (by start time) known to have been killed for lack of memory: that line of the journal stays true. */
const killedRuns = new Set<string>();

/**
 * Why a failed run stopped, from systemd's journal: an installer killed outright (systemd-oomd, the
 * kernel's OOM killer) never writes its exit line, so its own log cannot say.
 */
async function reasonOf(meta: UpgradeMeta): Promise<UpgradeStatus['reason']> {
  if (config.dryRun) return null;
  if (!killedRuns.has(meta.startedAt)) {
    // asked again while not found: the journal may not have been flushed the first time
    const since = Math.floor(Date.parse(meta.startedAt) / 1000);
    const r = await host.exec(`journalctl -u ${UPGRADE_UNIT} -u systemd-oomd --since @${since} -o cat --no-pager -n 200`);
    if (killedForMemory(r.stdout)) killedRuns.add(meta.startedAt);
  }
  return killedRuns.has(meta.startedAt) ? 'oom' : null;
}

export async function getUpgradeStatus(): Promise<UpgradeStatus> {
  const meta = getSetting<UpgradeMeta | null>('release.upgrade', null);
  const log = meta ? await fs.readFile(logFile(), 'utf8').catch(() => null) : null;
  const status = upgradeStatus(meta, log, await unitActive());
  return status.state === 'failed' && meta ? { ...status, reason: await reasonOf(meta) } : status;
}

export async function startUpgrade(version: string, log: HostLogger): Promise<UpgradeStatus> {
  const info = versionInfo();
  if (!info.updateAvailable || info.latest !== version || compareVersions(version, VERSION) <= 0) {
    throw conflict(t('Phiên bản {version} không phải bản mới nhất đã kiểm tra. Hãy bấm "Kiểm tra ngay" rồi thử lại.', { version }));
  }
  if ((await getUpgradeStatus()).state === 'running') throw conflict(t('Đang nâng cấp, hãy đợi lần này xong.'));

  const tag = `v${version}`;
  const command = upgradeCommand(releaseSettings.repo(), tag, logFile());
  await fs.writeFile(logFile(), '', { mode: 0o600 });
  setSetting('release.upgrade', { target: version, from: VERSION, startedAt: new Date().toISOString() } satisfies UpgradeMeta);
  log(t('Bắt đầu nâng cấp Lares {from} lên {to}', { from: VERSION, to: version }));
  await host.mutate(command, { log });
  // A laptop in dry-run has no installer to run: record a finished run so the UI flow can be tried.
  if (config.dryRun) await fs.appendFile(logFile(), `[dry-run] ${command}\n${EXIT_MARKER} 0\n`);
  return getUpgradeStatus();
}
