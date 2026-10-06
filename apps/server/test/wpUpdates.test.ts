import { describe, expect, it } from 'vitest';
import { wpPendingCount, wpUpdateRequestSchema, type WpInventory, type WpUpdateItem } from '@lares/shared';
import {
  baselineIssues,
  compareHealth,
  compareVersions,
  fatalKey,
  findCulprit,
  findJson,
  findMarkers,
  isFatalLine,
  lostItems,
  pageTitle,
  parseCoreCheckUpdate,
  parseCoreVersion,
  parseExtensionList,
  parseUpdateResults,
  selectItems,
  type HealthSnapshot,
  type PageProbe,
} from '../src/services/wpUpdatePolicy.js';

const NOTICE = 'PHP Deprecated:  Creation of dynamic property Foo::$bar is deprecated in /var/www/shop.example.com/public_html/wp-content/plugins/foo/foo.php on line 12';

describe('wp-cli output parsing', () => {
  it('finds the JSON document between PHP notices and the Success line', () => {
    expect(findJson(`${NOTICE}\n[{"a":1}]\nSuccess: done.`)).toEqual([{ a: 1 }]);
    expect(findJson('Success: WordPress is at the latest version.')).toBeNull();
    expect(findJson('[not json\n{"ok":true}')).toEqual({ ok: true });
  });

  it('reads the core version', () => {
    expect(parseCoreVersion('6.6.2\n')).toBe('6.6.2');
    expect(parseCoreVersion(`${NOTICE}\n6.7-RC1`)).toBe('6.7-RC1');
    expect(parseCoreVersion('Error: This does not seem to be a WordPress installation.')).toBeNull();
  });

  it('compares versions numerically', () => {
    expect(compareVersions('6.10', '6.9')).toBe(1);
    expect(compareVersions('6.7', '6.7.0')).toBe(0);
    expect(compareVersions('6.7-RC1', '6.7')).toBe(-1);
    expect(compareVersions('5.3.5', '5.3.10')).toBe(-1);
  });

  it('picks the newest offered core version', () => {
    const out =
      '[{"version":"6.7.1","update_type":"minor","package_url":"https://downloads.wordpress.org/release/wordpress-6.7.1-partial-0.zip"},{"version":"6.8","update_type":"major","package_url":"https://downloads.wordpress.org/release/wordpress-6.8.zip"}]';
    expect(parseCoreCheckUpdate(out)).toBe('6.8');
    expect(parseCoreCheckUpdate('Success: WordPress is at the latest version.')).toBeNull();
    expect(parseCoreCheckUpdate('[{"version":"<script>"}]')).toBeNull();
  });

  it('parses plugin lists and leaves out must-use plugins, drop-ins and unsafe names', () => {
    const out = `${NOTICE}
[{"name":"akismet","title":"Akismet Anti-spam: Spam Protection","status":"active","version":"5.3","update":"available","update_version":"5.3.5","auto_update":"off"},{"name":"hello","title":"Hello Dolly","status":"inactive","version":"1.7.2","update":"none","update_version":"","auto_update":"on"},{"name":"object-cache.php","title":"Redis Object Cache Drop-In","status":"dropin","version":"2.5.0","update":"none","update_version":"","auto_update":"off"},{"name":"lares-sso","title":"Lares one-click login","status":"must-use","version":"","update":"none","update_version":"","auto_update":"off"},{"name":"--exec=rm","title":"Evil","status":"inactive","version":"1","update":"available","update_version":"2","auto_update":"off"},{"name":"premium","title":"","status":"active-network","version":"2.0","update":"available","update_version":"","auto_update":"off"}]`;
    expect(parseExtensionList(out)).toEqual([
      { slug: 'akismet', title: 'Akismet Anti-spam: Spam Protection', status: 'active', version: '5.3', update: '5.3.5', autoUpdate: false },
      { slug: 'hello', title: 'Hello Dolly', status: 'inactive', version: '1.7.2', update: null, autoUpdate: true },
      // no update_version given: still flagged as having an update
      { slug: 'premium', title: 'premium', status: 'active-network', version: '2.0', update: '?', autoUpdate: false },
    ]);
    expect(parseExtensionList('Error: Could not open input file')).toBeNull();
  });

  it('parses theme lists from older wp-cli without title/auto_update', () => {
    const out = '[{"name":"twentytwentyfour","status":"active","version":"1.2","update":"available","update_version":"1.3"},{"name":"child","status":"inactive","version":"1.0","update":"none","update_version":""}]';
    expect(parseExtensionList(out)).toEqual([
      { slug: 'child', title: 'child', status: 'inactive', version: '1.0', update: null, autoUpdate: false },
      { slug: 'twentytwentyfour', title: 'twentytwentyfour', status: 'active', version: '1.2', update: '1.3', autoUpdate: false },
    ]);
  });

  it('parses the update summary, including failed items', () => {
    const out = `Downloading update from https://downloads.wordpress.org/plugin/akismet.5.3.5.zip...
Unpacking the update...
Installing the latest version...
Removing the old version of the plugin...
Plugin updated successfully.
[{"name":"akismet","old_version":"5.3","new_version":"5.3.5","status":"Updated"},{"name":"broken","old_version":"1.0","new_version":"1.1","status":"Error"},{"name":"pinned","old_version":"2.0","new_version":"2.1","status":"Skipped"}]
Error: Only updated 1 of 3 plugins.`;
    expect(parseUpdateResults(out)).toEqual([
      { slug: 'akismet', from: '5.3', to: '5.3.5', status: 'updated' },
      { slug: 'broken', from: '1.0', to: '1.1', status: 'failed' },
      { slug: 'pinned', from: '2.0', to: '2.1', status: 'unchanged' },
    ]);
    expect(parseUpdateResults('Error: No plugins installed.')).toEqual([]);
  });
});

const inventory = (): WpInventory => ({
  core: { version: '6.6.2', update: '6.7.1' },
  plugins: [
    { slug: 'akismet', title: 'Akismet', status: 'active', version: '5.3', update: '5.3.5', autoUpdate: false },
    { slug: 'hello', title: 'Hello Dolly', status: 'inactive', version: '1.7.2', update: null, autoUpdate: false },
    { slug: 'woocommerce', title: 'WooCommerce', status: 'active', version: '9.2.3', update: '9.3.1', autoUpdate: false },
  ],
  themes: [{ slug: 'twentytwentyfour', title: 'Twenty Twenty-Four', status: 'active', version: '1.2', update: '1.3', autoUpdate: false }],
});

describe('choosing what to update', () => {
  it('counts pending updates', () => {
    expect(wpPendingCount(inventory())).toBe(4);
    expect(wpPendingCount(null)).toBe(0);
  });

  it('"all" takes every pending item, core first', () => {
    const { items, missing } = selectItems(inventory(), wpUpdateRequestSchema.parse({ all: true }));
    expect(items.map((i) => `${i.type}:${i.slug}:${i.from}->${i.to}`)).toEqual(['core:wordpress:6.6.2->6.7.1', 'plugin:akismet:5.3->5.3.5', 'plugin:woocommerce:9.2.3->9.3.1', 'theme:twentytwentyfour:1.2->1.3']);
    expect(missing).toEqual([]);
  });

  it('takes only the selected items and reports those without an update', () => {
    const { items, missing } = selectItems(inventory(), wpUpdateRequestSchema.parse({ plugins: ['woocommerce', 'hello', 'nope'] }));
    expect(items.map((i) => i.slug)).toEqual(['woocommerce']);
    expect(missing).toEqual(['hello', 'nope']);
  });

  it('rejects slugs that could be read as wp-cli options', () => {
    expect(wpUpdateRequestSchema.safeParse({ plugins: ['--skip-plugins'] }).success).toBe(false);
    expect(wpUpdateRequestSchema.safeParse({ themes: ['a b'] }).success).toBe(false);
    expect(wpUpdateRequestSchema.safeParse({ plugins: ['wp-super-cache', 'hello.php'] }).success).toBe(true);
  });

  it('notices plugins that were deactivated or removed and a replaced theme', () => {
    const after = inventory();
    after.plugins = after.plugins.filter((p) => p.slug !== 'akismet');
    after.plugins.find((p) => p.slug === 'woocommerce')!.status = 'inactive';
    after.themes = [
      { ...after.themes[0]!, status: 'inactive' },
      { slug: 'twentytwentyfive', title: 'Twenty Twenty-Five', status: 'active', version: '1.0', update: null, autoUpdate: false },
    ];
    expect(lostItems(inventory(), after)).toEqual([
      { code: 'deactivated', slug: 'akismet', itemType: 'plugin' },
      { code: 'deactivated', slug: 'woocommerce', itemType: 'plugin' },
      { code: 'deactivated', slug: 'twentytwentyfour', itemType: 'theme' },
    ]);
    expect(lostItems(inventory(), inventory())).toEqual([]);
  });
});

const page = (over: Partial<PageProbe> = {}): PageProbe => ({ url: 'https://shop.example.com/', status: 200, title: 'Shop – Just another WordPress site', markers: [], bodyBytes: 40_000, ...over });
const snap = (over: Partial<HealthSnapshot> = {}): HealthSnapshot => ({
  at: '2026-10-05T03:00:00.000Z',
  home: page(),
  login: page({ url: 'https://shop.example.com/wp-login.php', title: 'Log In ‹ Shop — WordPress', bodyBytes: 5000 }),
  recentFatals: [],
  newFatals: [],
  ...over,
});

describe('page inspection', () => {
  it('extracts and decodes the title', () => {
    expect(pageTitle('<html><head><title>Shop &#8211; Just another &amp; site</title>')).toBe('Shop – Just another & site');
    expect(pageTitle('<title>\n  WordPress &rsaquo; Error\n</title>')).toBe('WordPress › Error');
    expect(pageTitle('<p>no title</p>')).toBe('');
  });

  it('finds WordPress / PHP error markers in any language', () => {
    expect(findMarkers('<p>There has been a critical error on this website.</p>')).toEqual(['critical']);
    expect(findMarkers('<body id="error-page"><div class="wp-die-message">Đã có lỗi nghiêm trọng</div>')).toEqual(['wp-die']); // i18n-ignore - sample page text
    expect(findMarkers('<br />\n<b>Fatal error</b>:  Uncaught Error: Call to undefined function foo()')).toEqual(['fatal']);
    expect(findMarkers('<h1>Error establishing a database connection</h1>')).toEqual(['database']);
    expect(findMarkers('Briefly unavailable for scheduled maintenance. Check back in a minute.')).toEqual(['maintenance']);
    expect(findMarkers('<html><title>Shop</title><body class="home">Welcome</body>')).toEqual([]);
  });

  it('recognises and normalises fatal error lines from nginx and debug.log', () => {
    const nginx =
      '2026/10/05 10:00:00 [error] 1234#1234: *56 FastCGI sent in stderr: "PHP message: PHP Fatal error:  Uncaught Error: Call to undefined function foo() in /var/www/shop.example.com/public_html/wp-content/plugins/woocommerce/woocommerce.php:12" while reading response header from upstream, client: 1.2.3.4, server: shop.example.com';
    const again = nginx.replace('10:00:00', '10:05:00').replace('*56', '*99').replace('1.2.3.4', '5.6.7.8');
    const debug = '[05-Oct-2026 10:00:00 UTC] PHP Fatal error:  Uncaught Error: Call to undefined function foo() in /var/www/shop.example.com/public_html/wp-content/plugins/woocommerce/woocommerce.php:12';
    expect(isFatalLine(nginx)).toBe(true);
    expect(isFatalLine('2026/10/05 10:00:00 [error] open() "/var/www/x/favicon.ico" failed (2: No such file or directory)')).toBe(false);
    expect(fatalKey(nginx)).toBe('PHP Fatal error: Uncaught Error: Call to undefined function foo() in /var/www/shop.example.com/public_html/wp-content/plugins/woocommerce/woocommerce.php:12');
    expect(fatalKey(again)).toBe(fatalKey(nginx));
    expect(fatalKey(debug)).toBe(fatalKey(nginx));
  });
});

describe('health comparison', () => {
  it('a healthy site stays healthy', () => {
    expect(compareHealth(snap(), snap())).toEqual([]);
    expect(baselineIssues(snap())).toEqual([]);
  });

  it('fails when the home page stops answering 2xx/3xx', () => {
    expect(compareHealth(snap(), snap({ home: page({ status: 500 }) }))).toEqual([{ code: 'status', page: 'home', before: 200, after: 500 }]);
    expect(compareHealth(snap(), snap({ home: page({ status: null, error: 'Connection refused' }) }))).toEqual([{ code: 'status', page: 'home', before: 200, after: null }]);
    // a redirect is fine
    expect(compareHealth(snap(), snap({ home: page({ status: 301 }) }))).toEqual([]);
  });

  it('does not blame the update for what was already wrong', () => {
    // login hidden by a security plugin before and after
    const hidden = snap({ login: page({ status: 404, title: 'Page not found' }) });
    expect(compareHealth(hidden, hidden)).toEqual([]);
    // the error text was already on the page
    const noisy = snap({ home: page({ markers: ['fatal'] }) });
    expect(compareHealth(noisy, noisy)).toEqual([]);
    expect(baselineIssues(snap({ home: page({ status: 503, markers: ['maintenance'] }) }))).toEqual([
      { code: 'status', page: 'home', before: 200, after: 503 },
      { code: 'marker', page: 'home', marker: 'maintenance' },
    ]);
    // ...but it does get worse: 404 → 500
    expect(compareHealth(hidden, snap({ login: page({ status: 500, title: 'Page not found' }) }))).toEqual([{ code: 'status', page: 'login', before: 404, after: 500 }]);
  });

  it('fails on new critical-error markers', () => {
    expect(compareHealth(snap(), snap({ home: page({ status: 500, markers: ['critical'], title: 'WordPress › Error' }) }))).toEqual([
      { code: 'status', page: 'home', before: 200, after: 500 },
      { code: 'marker', page: 'home', marker: 'critical' },
      { code: 'title', page: 'home', before: 'Shop – Just another WordPress site', after: 'WordPress › Error' },
    ]);
  });

  it('fails when the title turns into an error page, not on a normal title change', () => {
    expect(compareHealth(snap(), snap({ home: page({ title: 'Database Error' }) }))).toEqual([{ code: 'title', page: 'home', before: 'Shop – Just another WordPress site', after: 'Database Error' }]);
    expect(compareHealth(snap(), snap({ home: page({ title: 'Shop | Fresh new tagline' }) }))).toEqual([]);
  });

  it('fails on a white screen', () => {
    expect(compareHealth(snap(), snap({ home: page({ bodyBytes: 0, title: '' }) }))).toEqual([{ code: 'blank', page: 'home' }]);
  });

  it('fails on new fatal errors only', () => {
    const known = 'PHP Fatal error: Allowed memory size exhausted in /var/www/x/wp-includes/class-wpdb.php:2345';
    const fresh = 'PHP Fatal error: Uncaught Error: Call to undefined function foo() in /var/www/x/wp-content/plugins/woocommerce/woocommerce.php:12';
    expect(compareHealth(snap({ recentFatals: [known] }), snap({ newFatals: [known] }))).toEqual([]);
    expect(compareHealth(snap({ recentFatals: [known] }), snap({ newFatals: [known, fresh, fresh] }))).toEqual([{ code: 'fatal', line: fresh }]);
  });
});

describe('culprit', () => {
  const item = (type: WpUpdateItem['type'], slug: string, name: string, status: WpUpdateItem['status'] = 'updated'): WpUpdateItem => ({ type, slug, name, from: '1', to: '2', status });

  it('names the only updated item', () => {
    expect(findCulprit([item('plugin', 'akismet', 'Akismet'), item('plugin', 'hello', 'Hello', 'skipped')], [{ code: 'status', page: 'home', before: 200, after: 500 }])).toEqual({ kind: 'single', items: ['Akismet'] });
  });

  it('points at the items named by new fatal errors or deactivated', () => {
    const items = [item('core', 'wordpress', 'WordPress'), item('plugin', 'akismet', 'Akismet'), item('plugin', 'woocommerce', 'WooCommerce'), item('theme', 'astra', 'Astra')];
    expect(findCulprit(items, [{ code: 'fatal', line: 'PHP Fatal error: Uncaught Error in /var/www/x/public_html/wp-content/plugins/woocommerce/includes/a.php:3' }])).toEqual({ kind: 'suspects', items: ['WooCommerce'] });
    expect(findCulprit(items, [{ code: 'deactivated', slug: 'astra', itemType: 'theme' }])).toEqual({ kind: 'suspects', items: ['Astra'] });
  });

  it('says it is unknown when several items changed and nothing points at one', () => {
    const items = [item('plugin', 'akismet', 'Akismet'), item('plugin', 'woocommerce', 'WooCommerce')];
    expect(findCulprit(items, [{ code: 'status', page: 'home', before: 200, after: 500 }])).toEqual({ kind: 'multiple', items: ['Akismet', 'WooCommerce'] });
  });
});
