import { describe, expect, it } from 'vitest';
import { cleanHostnames, detectPhpVersion, parseApache, parseCpanelUserdata, parseHestiaWebConf, parseNginx, pickPrimary, vhostsToSites } from '../src/migration/panels/parsers.js';
import { dbFromEnv, isNextPackage, parseDbHost, parseDotEnv, parseWpConfig, rewriteDotEnv } from '../src/migration/appDetect.js';
import { rewriteWpConfig } from '../src/services/wordpress.js';
import { parseAccessLine, parseNginxTime } from '../src/services/logs.js';
import { shq } from '../src/lib/shell.js';

describe('shq', () => {
  it('quotes single quotes safely', () => {
    expect(shq("it's")).toBe(`'it'\\''s'`);
    expect(shq('$(rm -rf /)')).toBe(`'$(rm -rf /)'`);
  });
});

describe('nginx parser', () => {
  const dump = `### FILE: /www/server/panel/vhost/nginx/example.com.conf
server
{
    listen 80;
    listen 443 ssl http2;
    server_name example.com www.example.com;
    index index.php index.html;
    root /www/wwwroot/example.com;
    # comment with server_name fake.com;
    include enable-php-81.conf;
    location ~ .*\\.(gif|jpg)$ { expires 30d; }
}
### FILE: /etc/nginx/sites-enabled/app.io
upstream up { server 127.0.0.1:3000; }
server {
    listen 80;
    server_name app.io;
    location / {
        proxy_pass http://127.0.0.1:3000;
    }
}
### FILE: /etc/nginx/sites-enabled/lares.conf
# Managed by Lares - changes will be overwritten
server { server_name own.com; root /var/www/own.com/public_html; }
`;
  it('extracts domains, roots, php version and proxies; skips Lares vhosts', () => {
    const v = parseNginx(dump);
    expect(v).toHaveLength(2);
    expect(v[0]).toMatchObject({ root: '/www/wwwroot/example.com', phpVersion: '8.1' });
    expect(v[0]!.serverNames).toEqual(['example.com', 'www.example.com']);
    expect(v[1]).toMatchObject({ root: null, proxyPass: 'http://127.0.0.1:3000' });
    const sites = vhostsToSites(v, 'test');
    expect(sites.map((s) => s.domain)).toEqual(['example.com', 'app.io']);
    expect(sites[0]!.aliases).toEqual(['www.example.com']);
  });

  it('merges 80/443 blocks and prefers apex domain', () => {
    const d = `### FILE: a\nserver { server_name www.a.com a.com; root /x; }\nserver { listen 443; server_name a.com; fastcgi_pass unix:/run/php/php7.4-fpm.sock; }\n`;
    const s = vhostsToSites(parseNginx(d), 't');
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ domain: 'a.com', aliases: ['www.a.com'], rootPath: '/x' });
  });
});

describe('apache parser', () => {
  it('parses VirtualHost blocks', () => {
    const d = `### FILE: /etc/apache2/sites-enabled/b.conf
<VirtualHost *:80>
  ServerName b.com
  ServerAlias www.b.com shop.b.com
  DocumentRoot "/home/b/public_html"
  <FilesMatch \\.php$>
    SetHandler "proxy:unix:/opt/cpanel/ea-php82/root/usr/var/run/php-fpm/x.sock|fcgi://b.com"
  </FilesMatch>
</VirtualHost>`;
    const v = parseApache(d);
    expect(v[0]).toMatchObject({ root: '/home/b/public_html', phpVersion: '8.2' });
    expect(v[0]!.serverNames).toEqual(['b.com', 'www.b.com', 'shop.b.com']);
  });
});

describe('panel helpers', () => {
  it('cleans hostnames', () => {
    expect(cleanHostnames(['_', 'localhost', '1.2.3.4', '*.x.com', '~^re$', 'OK.com.'])).toEqual(['ok.com']);
    expect(pickPrimary(['www.z.com', 'z.com'])).toEqual({ domain: 'z.com', aliases: ['www.z.com'] });
  });
  it('parses hestia web.conf', () => {
    const r = parseHestiaWebConf(`DOMAIN='h.com' IP='1.1.1.1' ALIAS='www.h.com' BACKEND='PHP-8_2' CUSTOM_DOCROOT=''\n`);
    expect(r[0]).toMatchObject({ DOMAIN: 'h.com', ALIAS: 'www.h.com' });
    expect(detectPhpVersion(r[0]!.BACKEND!)).toBe('8.2');
  });
  it('parses cPanel userdata grep output', () => {
    const r = parseCpanelUserdata(
      '/var/cpanel/userdata/bob/bob.com:documentroot: /home/bob/public_html\n/var/cpanel/userdata/bob/bob.com:servername: bob.com\n/var/cpanel/userdata/bob/bob.com:phpversion: ea-php81\n',
    );
    expect(r).toEqual([{ file: '/var/cpanel/userdata/bob/bob.com', user: 'bob', fields: { documentroot: '/home/bob/public_html', servername: 'bob.com', phpversion: 'ea-php81' } }]);
  });
});

describe('app config parsing', () => {
  const wp = `<?php
define( 'DB_NAME', 'wp_db' );
define('DB_USER', "wp_user");
define( 'DB_PASSWORD', 'p\\'a$s"w' );
define( 'DB_HOST', 'localhost:/var/run/mysqld/mysqld.sock' );
$table_prefix = 'xyz_';
`;
  it('parses wp-config.php', () => {
    expect(parseWpConfig(wp)).toEqual({ host: 'localhost', socket: '/var/run/mysqld/mysqld.sock', name: 'wp_db', user: 'wp_user', password: `p'a$s"w`, prefix: 'xyz_' });
  });
  it('rewrites wp-config.php credentials', () => {
    const out = rewriteWpConfig(wp, { name: 'new_db', user: 'new_u', password: 'Abc123', host: 'localhost' });
    const parsed = parseWpConfig(out)!;
    expect(parsed).toMatchObject({ name: 'new_db', user: 'new_u', password: 'Abc123', host: 'localhost', prefix: 'xyz_' });
  });
  it('parses DB hosts', () => {
    expect(parseDbHost('127.0.0.1:3307')).toEqual({ host: '127.0.0.1', port: 3307 });
    expect(parseDbHost('[::1]:3306')).toEqual({ host: '::1', port: 3306 });
    expect(parseDbHost('')).toEqual({ host: 'localhost' });
  });
  it('parses .env and rewrites DB keys', () => {
    const env = `APP_URL=https://old.com\nDB_CONNECTION=mysql\nDB_HOST=127.0.0.1\nDB_DATABASE="lara"\nDB_USERNAME=u # comment\nDB_PASSWORD='s3cr3t'\n`;
    expect(dbFromEnv(parseDotEnv(env))).toMatchObject({ name: 'lara', user: 'u', password: 's3cr3t' });
    const out = rewriteDotEnv(env, { DB_DATABASE: 'x', DB_PORT: '3306' });
    expect(out).toContain('DB_DATABASE=x');
    expect(out).toContain('DB_PORT=3306');
    expect(out).toContain('APP_URL=https://old.com');
  });
  it('detects Next.js packages', () => {
    expect(isNextPackage('{"dependencies":{"next":"15.0.0","react":"19"}}')).toBe(true);
    expect(isNextPackage('{"dependencies":{"react":"19"}}')).toBe(false);
    expect(isNextPackage('not json')).toBe(false);
  });
});

describe('access log parsing', () => {
  it('parses nginx time with offset', () => {
    expect(new Date(parseNginxTime('10/Oct/2026:13:55:36 +0700')!).toISOString()).toBe('2026-10-10T06:55:36.000Z');
  });
  it('parses lares log format', () => {
    const l = parseAccessLine('1.2.3.4 - - [10/Oct/2026:13:55:36 +0700] "GET /blog?page=2 HTTP/2.0" 200 5120 "https://google.com/" "Mozilla/5.0" 0.042');
    expect(l).toMatchObject({ ip: '1.2.3.4', method: 'GET', path: '/blog', status: 200, bytes: 5120, referrer: 'https://google.com/', responseTime: 0.042 });
    expect(parseAccessLine('garbage')).toBeNull();
  });
});

describe('wp-config port fix', async () => {
  const { addPortHostFix, renderWpConfig } = await import('../src/services/wordpress.js');
  it('is part of generated configs and keeps credentials parseable', () => {
    const cfg = renderWpConfig({ name: 'd', user: 'u', password: 'p', host: 'localhost' });
    expect(cfg).toContain('LARES_PORT_HOST_FIX');
    expect(parseWpConfig(cfg)).toMatchObject({ name: 'd', user: 'u', password: 'p' });
  });
  it('patches old configs once, right after <?php', () => {
    const old = "<?php\ndefine( 'DB_NAME', 'x' );\ndefine( 'DB_USER', 'y' );\n";
    const once = addPortHostFix(old);
    expect(once.startsWith("<?php\n// LARES_PORT_HOST_FIX")).toBe(true);
    expect(addPortHostFix(once)).toBe(once);
    expect(parseWpConfig(once)).toMatchObject({ name: 'x', user: 'y' });
  });
});

describe('WordPress URL move', async () => {
  const { urlReplacePairs } = await import('../src/services/wordpress.js');
  it('http -> https on the same domain only upgrades the scheme', () => {
    expect(urlReplacePairs('http://dalat.vn', 'https://dalat.vn')).toEqual([['http://dalat.vn', 'https://dalat.vn']]);
  });
  it('port site straight to an https domain', () => {
    expect(urlReplacePairs('http://1.2.3.4:8001/', 'https://a.vn')).toEqual([
      ['//1.2.3.4:8001', '//a.vn'],
      ['\\/\\/1.2.3.4:8001', '\\/\\/a.vn'],
      ['http://a.vn', 'https://a.vn'],
    ]);
  });
  it('https site cloned to a new domain without certificate goes back to http', () => {
    expect(urlReplacePairs('https://a.vn', 'http://b.vn')).toEqual([
      ['//a.vn', '//b.vn'],
      ['\\/\\/a.vn', '\\/\\/b.vn'],
      ['https://b.vn', 'http://b.vn'],
    ]);
  });
});
