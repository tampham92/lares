import fs from 'node:fs/promises';
import { host } from './host.js';

/**
 * Write (or with `content === null` delete) an nginx conf file, then `nginx -t` + reload.
 * Returns false when the file already had that content. If nginx rejects the new file the
 * previous one is put back, so a running nginx never loses its working configuration.
 */
export async function writeNginxConf(file: string, content: string | null, reload: () => Promise<void>): Promise<boolean> {
  const previous = await fs.readFile(file, 'utf8').catch(() => null);
  if (previous === content) return false;
  if (content === null) await fs.rm(file, { force: true });
  else await host.writeFile(file, content);
  try {
    await reload();
  } catch (err) {
    if (previous === null) await fs.rm(file, { force: true });
    else await host.writeFile(file, previous);
    throw err;
  }
  return true;
}
