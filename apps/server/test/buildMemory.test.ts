import { describe, expect, it } from 'vitest';
import { buildMemoryMaxMb, buildScopeName, isOutOfMemory, lowPriorityCommand, parseMeminfo, scopeKilledForMemory, swapPlan } from '../src/services/buildMemoryPolicy.js';

const MEMINFO = `MemTotal:        2014856 kB
MemFree:           81234 kB
MemAvailable:     612352 kB
Buffers:           12000 kB
SwapTotal:             0 kB
SwapFree:              0 kB
`;

describe('build memory', () => {
  it('parses /proc/meminfo in MB', () => {
    expect(parseMeminfo(MEMINFO)).toEqual({ totalMb: 1967, availableMb: 598, swapFreeMb: 0 });
    expect(parseMeminfo('')).toBeNull();
    expect(parseMeminfo('MemTotal: 2014856 kB\n')).toBeNull();
  });

  it('adds a temporary swap only when the machine is short and the disk has room', () => {
    const short = { totalMb: 1967, availableMb: 598, swapFreeMb: 0 };
    expect(swapPlan(short, 20_000)).toBe('add');
    expect(swapPlan(short, 2500)).toBe('no-disk');
    expect(swapPlan({ ...short, swapFreeMb: 4096 }, 20_000)).toBe('enough');
    expect(swapPlan({ totalMb: 8000, availableMb: 6000, swapFreeMb: 0 }, 500)).toBe('enough');
  });

  it('caps the build at 75 % of RAM', () => {
    expect(buildMemoryMaxMb({ totalMb: 1967, availableMb: 600, swapFreeMb: 2048 })).toBe(1475);
  });

  it('wraps the build in a low-priority scope', () => {
    const unit = buildScopeName('shop.example.com', 3);
    expect(unit).toBe('lares-build-shop.example.com-3.scope');
    const cmd = lowPriorityCommand("runuser -u site1 -- bash -c 'npm run build'", unit, 1475);
    expect(cmd).toBe(
      "systemd-run --scope --quiet --collect --unit='lares-build-shop.example.com-3.scope' -p CPUWeight=20 -p IOWeight=20 " +
        "-p MemoryMax=1475M -- nice -n 10 runuser -u site1 -- bash -c 'npm run build'",
    );
    expect(lowPriorityCommand('npm ci', unit, null)).toBe('nice -n 10 npm ci');
  });

  it('keeps unit names valid for any domain', () => {
    expect(buildScopeName('xn--bcher-kva.de', 1)).toMatch(/^[A-Za-z0-9:_.\\-]+$/);
    expect(buildScopeName('a b;$(x)', 1)).toBe('lares-build-a-b---x--1.scope');
  });

  it('recognises a build killed for lack of memory', () => {
    expect(isOutOfMemory('', 137)).toBe(true);
    expect(isOutOfMemory('Next.js build worker exited with code: null and signal: SIGKILL', 1)).toBe(true);
    expect(isOutOfMemory('FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory', 134)).toBe(true);
    expect(isOutOfMemory('npm ERR! command failed\nKilled\n', 1)).toBe(true);
    expect(isOutOfMemory("Type error: Property 'x' does not exist", 1)).toBe(false);
    expect(isOutOfMemory('', 1)).toBe(false);
  });

  it('reads an OOM kill of the scope from the journal (output only says "Session terminated")', () => {
    const unit = 'lares-build-a.com-1.scope';
    // captured on Ubuntu 24.04 (systemd 255)
    const journal = [
      'pam_unix(runuser:session): session opened for user site1(uid=1001) by ubuntu(uid=0)',
      `${unit}: A process of this unit has been killed by the OOM killer.`,
      'pam_unix(runuser:session): session closed for user site1',
      `${unit}: Failed with result 'oom-kill'.`,
    ].join('\n');
    expect(scopeKilledForMemory(journal, unit)).toBe(true);
    expect(scopeKilledForMemory(journal, 'lares-build-a.com-2.scope')).toBe(false);
    expect(scopeKilledForMemory(`${unit}: Deactivated successfully.`, unit)).toBe(false);
  });
});
