import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { SHARED_EN, translate, type Dict } from '@lares/shared';
import { EN as SERVER_EN } from '../src/i18n/en/index.js';
import { requestLang, runWithLang, t } from '../src/i18n/index.js';
import { EN as WEB_EN } from '../../web/src/i18n/en/index.js';

const ROOT = path.resolve(__dirname, '../../..');
const VI_CHAR = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (rel.endsWith(path.join('i18n', 'en'))) continue; // the dictionaries themselves
      out.push(...sourceFiles(rel));
    } else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(rel);
  }
  return out;
}

const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const unescape = (s: string) => s.replace(/\\(['"`\\])/g, '$1');

/** Every literal msgid passed to t(...) in a file that imports t from an i18n module. */
function msgids(src: string): string[] {
  const ids: string[] = [];
  if (!/import\s*\{[^}]*\b(t|tDefault|msg)\b[^}]*\}\s*from\s*['"][^'"]*(i18n|@lares\/shared)/.test(src)) return ids;
  for (const m of src.matchAll(/\b(?:t|tDefault|msg)\(\s*(['"])((?:\\.|(?!\1)[^\\\n])*)\1/g)) ids.push(unescape(m[2]!));
  for (const m of src.matchAll(/\b(?:t|tDefault|msg)\(\s*`([^`$]*)`/g)) ids.push(unescape(m[1]!));
  return ids;
}

/** Lines that still show Vietnamese outside t(...)/msg(...), comments and `i18n-ignore` lines. */
function untranslated(rel: string): string[] {
  const hits: string[] = [];
  read(rel)
    .split('\n')
    .forEach((line, i) => {
      if (!VI_CHAR.test(line) || line.includes('i18n-ignore')) return;
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
      const stripped = line
        .replace(/\b(?:t|tDefault|msg)\(\s*(['"])(?:\\.|(?!\1)[^\\])*\1/g, 't(')
        .replace(/\b(?:t|tDefault|msg)\(\s*`[^`$]*`/g, 't(')
        .replace(/\s\/\/.*$/, '')
        .replace(/\/\*.*?\*\//g, '');
      if (VI_CHAR.test(stripped)) hits.push(`${rel}:${i + 1}: ${trimmed.slice(0, 120)}`);
    });
  return hits;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

const WEB_FILES = sourceFiles('apps/web/src');
const SERVER_FILES = sourceFiles('apps/server/src');

describe('i18n', () => {
  it('translates and fills placeholders', () => {
    expect(translate({ 'Xin chào {name}': 'Hello {name}' }, 'Xin chào {name}', { name: 'Tâm' })).toBe('Hello Tâm');
    expect(translate(null, 'Xin chào {name}', { name: 'Tâm' })).toBe('Xin chào Tâm');
    expect(translate({}, 'Chưa dịch {x}', {})).toBe('Chưa dịch {x}');
  });

  it('every t() msgid in the web app has English', () => {
    const missing = WEB_FILES.flatMap((f) => msgids(read(f)).filter((id) => !(id in WEB_EN)).map((id) => `${f}: ${id}`));
    expect([...new Set(missing)]).toEqual([]);
  });

  it('every t() msgid in the server has English', () => {
    const missing = SERVER_FILES.flatMap((f) => msgids(read(f)).filter((id) => !(id in SERVER_EN)).map((id) => `${f}: ${id}`));
    expect([...new Set(missing)]).toEqual([]);
  });

  it('every Vietnamese string in @lares/shared has English', () => {
    const src = read('packages/shared/src/index.ts');
    const missing = [...src.matchAll(/(['"])((?:\\.|(?!\1)[^\\\n])*)\1/g)]
      .map((m) => unescape(m[2]!))
      .filter((s) => VI_CHAR.test(s) && !(s in SHARED_EN));
    expect([...new Set(missing)]).toEqual([]);
  });

  it('dictionaries keep the same placeholders as their source text', () => {
    const bad = ([['web', WEB_EN], ['server', SERVER_EN]] as Array<[string, Dict]>).flatMap(([name, dict]) =>
      Object.entries(dict)
        .filter(([vi, en]) => placeholders(vi).join() !== placeholders(en).join())
        .map(([vi, en]) => `${name}: ${vi} → ${en}`),
    );
    expect(bad).toEqual([]);
  });

  it('no Vietnamese text is left outside t()', () => {
    expect([...WEB_FILES, ...SERVER_FILES].flatMap(untranslated)).toEqual([]);
  });

  it('picks the request language from header, query, then Accept-Language', () => {
    expect(requestLang({ 'x-lares-lang': 'en' }, {})).toBe('en');
    expect(requestLang({}, { lang: 'en' })).toBe('en');
    expect(requestLang({ 'accept-language': 'en-US,en;q=0.9' }, {})).toBe('en');
    expect(requestLang({ 'x-lares-lang': 'fr' }, { lang: 'vi' })).toBe('vi');
  });

  it('carries the request language into async handlers', async () => {
    const app = Fastify();
    app.addHook('onRequest', (req, _reply, done) => runWithLang(requestLang(req.headers, req.query), done));
    app.get('/x', async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { msg: t('Không tìm thấy') };
    });
    const en = await app.inject({ url: '/x', headers: { 'x-lares-lang': 'en' } });
    const vi = await app.inject({ url: '/x', headers: { 'x-lares-lang': 'vi' } });
    expect(en.json().msg).toBe('Not found');
    expect(vi.json().msg).toBe('Không tìm thấy');
  });
});
