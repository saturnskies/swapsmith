import { expect, test } from '@playwright/test';

test('manifest is linked and every icon it lists loads', async ({ page, request }) => {
  await page.route('https://api.scryfall.com/**', (route) => route.abort());
  await page.goto('./');

  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBe('/swapsmith/manifest.webmanifest');
  const manifestUrl = new URL(href!, page.url()).href;
  const manifest = await (await request.get(manifestUrl)).json();

  expect(manifest).toMatchObject({ name: 'Swapsmith', display: 'standalone', start_url: './', scope: './' });
  const sizes = manifest.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes}:${i.purpose}`);
  expect(sizes).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']));
  for (const icon of manifest.icons) {
    const res = await request.get(new URL(icon.src, manifestUrl).href);
    expect(res.status(), icon.src).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
  }
  // The browser bar follows the colour scheme (header surface colours); the manifest keeps the brand black.
  await expect(page.locator('meta[name="theme-color"]')).toHaveCount(2);
  expect(manifest.theme_color).toBe('#000000');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
});

test.describe('service worker', () => {
  test.use({ serviceWorkers: 'allow' });

  test('opens offline after a single visit, fonts and styles included', async ({ page, context }) => {
    await page.route('https://api.scryfall.com/**', (route) => route.abort());
    await page.goto('./');
    // Installing saves the page and every built file; nothing here was loaded through the worker.
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

    const list: string[] = await (await page.request.get(new URL('precache.json', page.url()).href)).json();
    expect(list.some((f) => f.endsWith('.js'))).toBe(true);
    expect(list.some((f) => f.endsWith('.css'))).toBe(true);
    expect(list.some((f) => f.endsWith('.woff2'))).toBe(true);
    const saved: string[] = await page.evaluate(async () => {
      const names = (await caches.keys()).filter((k) => k.startsWith('swapsmith-shell-'));
      const reqs = await Promise.all(names.map(async (n) => (await caches.open(n)).keys()));
      return reqs.flat().map((r) => new URL(r.url).pathname);
    });
    for (const f of list) expect(saved, f).toContain(`/swapsmith/${f}`);

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Swapsmith' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your decks' })).toBeVisible();
    // The stylesheet and the heading font came from the saved copies, not the network.
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.site-header')!).borderBottomStyle)).toBe('solid');
    await expect.poll(() => page.evaluate(() => [...document.fonts].some((f) => f.family.includes('Bricolage Grotesque') && f.status === 'loaded'))).toBe(true);
  });

  test('asks no font host for anything', async ({ page }) => {
    const hosts = new Set<string>();
    page.on('request', (r) => hosts.add(new URL(r.url()).hostname));
    await page.route('https://api.scryfall.com/**', (route) => route.abort());
    await page.goto('./');
    await expect(page.getByRole('heading', { name: 'Your decks' })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect([...hosts].filter((h) => h !== 'localhost' && h !== 'api.scryfall.com')).toEqual([]);
  });

  test('registers, takes control, and opens the app shell offline', async ({ page, context }) => {
    await page.route('https://api.scryfall.com/**', (route) => route.abort());
    await page.goto('./');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); // first load is uncontrolled; the reload is served through the worker
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Swapsmith' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your decks' })).toBeVisible();
  });
});
