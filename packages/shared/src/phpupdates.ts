// ---------------------------------------------------------------------------
// PHP security updates (Settings > Updates): patch releases of the installed PHP branches, which
// come from the ondrej / sury repository that the OS's unattended-upgrades leaves alone.
// ---------------------------------------------------------------------------
import { z } from 'zod';

/**
 * Security support of a PHP branch on php.net: 'ending' = security fixes stop within a few months,
 * 'eol' = no more security releases, 'unknown' = a branch the panel has no date for.
 */
export type PhpSupport = 'supported' | 'ending' | 'eol' | 'unknown';

/** One package the upgrade would change: full Debian versions (`from` null = newly pulled in). */
export interface PhpPackageUpdate {
  name: string;
  from: string | null;
  to: string;
}

export interface PhpBranchUpdates {
  /** "8.3" */
  branch: string;
  /** Upstream version of php<branch>-fpm ("8.3.12"), null when it cannot be read. */
  installed: string | null;
  /** Upstream version the upgrade installs; equal to `installed` for a rebuilt package. */
  available: string | null;
  packages: PhpPackageUpdate[];
  support: PhpSupport;
  /** End of security support on php.net (YYYY-MM-DD), null when unknown. */
  eolDate: string | null;
  /** Sites served by this branch. */
  sites: number;
}

export interface PhpUpdateRun {
  at: string;
  ok: boolean;
  /** Started by the daily automatic update rather than by the admin. */
  auto: boolean;
  /** Branches that were upgraded. */
  branches: string[];
  error: string | null;
}

export interface PhpUpdatesView {
  branches: PhpBranchUpdates[];
  /** Packages that are not tied to one branch (php-common, libraries from the same repository). */
  others: PhpPackageUpdate[];
  /** Last time the package lists were refreshed and the updates computed. */
  checkedAt: string | null;
  /** Why the last check failed (lists kept from the check before). */
  error: string | null;
  /** Install patch releases on their own each night. */
  autoUpdate: boolean;
  lastRun: PhpUpdateRun | null;
  /** Task id of an upgrade that is running now. */
  running: string | null;
}

export const phpUpdateSettingsSchema = z.object({ autoUpdate: z.boolean() });

/** "Install updates": every pending PHP package, or those of the branches given. */
export const phpUpgradeRequestSchema = z.object({ branches: z.array(z.string().regex(/^\d\.\d$/)).max(20).optional() });
