import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { allocateSitePort, isSitePortFree, portsWithSiteDir } from '../src/services/ports.js';

describe('port-based site allocation', () => {
  const start = config.sitePortStart;
  // a site that got a real domain still lives in its old port folder
  const kept = path.join(config.sitesRoot, `site${start}.localhost`);
  fs.mkdirSync(path.join(kept, 'public_html'), { recursive: true });
  fs.mkdirSync(path.join(config.sitesRoot, 'site-not-a-port.localhost'), { recursive: true });
  afterAll(() => {
    fs.rmSync(kept, { recursive: true, force: true });
    fs.rmSync(path.join(config.sitesRoot, 'site-not-a-port.localhost'), { recursive: true, force: true });
  });

  it('skips a port whose site folder still exists', async () => {
    expect([...(await portsWithSiteDir())]).toContain(start);
    expect(await allocateSitePort()).not.toBe(start);
    expect(await isSitePortFree(start)).toBe(false);
  });
});
