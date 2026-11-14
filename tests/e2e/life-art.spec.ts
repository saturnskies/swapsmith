import { expect, test, type Locator, type Page } from '@playwright/test';
import { SCRIM_ALPHA } from '../../src/lib/art';
import { composite, contrastRatio, effectiveBackground, parseColor } from '../support/contrast';
import { solidPng } from '../support/png';
import { artReplies, mockArt, type ArtMock } from './helpers';
import { editPlayers, menu, start, tile } from './life-helpers';

let art: ArtMock;
test.beforeEach(async ({ page }) => {
  art = await mockArt(page);
});

const choose = (page: Page, seat: number) => page.getByRole('button', { name: `Choose art for player ${seat}` });
const random = (page: Page, seat: number) => page.getByRole('button', { name: `Random art for player ${seat}` });
const remove = (page: Page, seat: number) => page.getByRole('button', { name: `Remove art for player ${seat}` });
const picker = (page: Page, seat = 1) => page.getByRole('dialog', { name: `Art for Player ${seat}` });
const box = (p: Locator) => p.getByRole('textbox', { name: 'Card name or artist' });
const searchButton = (p: Locator) => p.getByRole('button', { name: 'Search', exact: true });
const cell = (p: Locator, name: string) => p.getByRole('button', { name, exact: true });
const DUNGEON = 'Dungeon Delver, art by Josh Freydkis';
const NOTE = (p: Page, seat: number) => p.locator('.player-row').nth(seat - 1).locator('.art-note');

/** Menu → Edit names & colors → the seat's Art button; the picker is open when this returns. */
async function openPicker(page: Page, seat = 1) {
  const edit = page.getByRole('dialog', { name: 'Edit players' });
  if (!(await edit.isVisible())) await editPlayers(page);
  await choose(page, seat).click();
  await expect(picker(page, seat)).toBeVisible();
  return picker(page, seat);
}
async function search(p: Locator, text: string) {
  await box(p).fill(text);
  await searchButton(p).click();
}
/** Opens the picker, searches "delver" and taps the Dungeon Delver cell. */
async function pickDungeon(page: Page, seat = 1) {
  const p = await openPicker(page, seat);
  await search(p, 'delver');
  await cell(p, DUNGEON).click();
  await expect(tile(page, seat - 1)).toHaveAttribute('data-art', 'true');
}
/** Every row of the art cache, read from the page's own IndexedDB. */
const cachedRows = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<Array<{ id: string; bytes: number; lastUsed: number }>>((resolve, reject) => {
        const open = indexedDB.open('swapsmith-art', 1);
        open.onsuccess = () => {
          const req = open.result.transaction('images').objectStore('images').getAll();
          req.onsuccess = () => resolve(req.result.map((r: { id: string; bytes: number; lastUsed: number }) => ({ id: r.id, bytes: r.bytes, lastUsed: r.lastUsed })));
          req.onerror = () => reject(req.error);
        };
        open.onerror = () => reject(open.error);
      }),
  );
/** Writes rows straight into the cache (`id`, `lastUsed`), or deletes them (`lastUsed` null). */
const writeRows = (page: Page, rows: Array<{ id: string; lastUsed: number | null }>) =>
  page.evaluate(
    (list) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('swapsmith-art', 1);
        open.onsuccess = () => {
          const tx = open.result.transaction('images', 'readwrite');
          const store = tx.objectStore('images');
          for (const r of list) {
            if (r.lastUsed === null) store.delete(r.id);
            else store.put({ id: r.id, blob: new Blob([new Uint8Array(10)], { type: 'image/jpeg' }), bytes: 10, lastUsed: r.lastUsed });
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        open.onerror = () => reject(open.error);
      }),
    rows,
  );
const lastUsedOf = async (page: Page, id: string) => (await cachedRows(page)).find((r) => r.id === id)?.lastUsed;
const artId = (page: Page, seat: number) => page.evaluate((s) => JSON.parse(localStorage.getItem('swapsmith:life') ?? '{}').game?.players?.[s]?.art?.id as string | undefined, seat);

test.describe('the picker', () => {
  test('opens from a seat\'s Art button, is labelled, starts in the search box, and Escape closes it', async ({ page }) => {
    await start(page);
    const p = await openPicker(page, 2);
    await expect(p).toHaveAccessibleName('Art for Player 2');
    await expect(box(p)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog.art-picker')).toHaveCount(0);
    // The Edit players dialog it opened over is still there, with focus back on the button.
    await expect(page.getByRole('dialog', { name: 'Edit players' })).toBeVisible();
    await expect(choose(page, 2)).toBeFocused();
  });

  test('a search by name shows a grid of art crops, each named "Card, art by Artist", and no result total', async ({ page }) => {
    await start(page);
    const p = await openPicker(page);
    await search(p, 'delver');
    await expect(cell(p, DUNGEON)).toBeVisible();
    // 13 cards came back; Lost Mine of Phandelver has no artist and is dropped. A two-faced card is credited to its front face's artist.
    await expect(p.locator('.art-cell')).toHaveCount(12);
    await expect(cell(p, 'Delver of Secrets // Insectile Aberration, art by Florey')).toBeVisible();
    await expect(p.locator('.art-cell img').first()).toHaveAttribute('src', /^https:\/\/cards\.scryfall\.io\/art_crop\//);
    expect(art.searches).toEqual(['name:"delver" is:highres']);
    // The count shown is the cards shown, never Scryfall's total (which counts the card it dropped).
    await expect(p.getByRole('status').filter({ hasText: 'Showing 12' })).toBeVisible();
    await expect(p).not.toContainText('13');
  });

  test('switching the box to Artist searches a:', async ({ page }) => {
    await start(page);
    const p = await openPicker(page);
    const by = p.getByRole('group', { name: 'Search by' });
    await expect(by.getByRole('button', { name: 'Name', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await by.getByRole('button', { name: 'Artist', exact: true }).click();
    await expect(by.getByRole('button', { name: 'Artist', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await search(p, 'quinton hoover');
    await expect(cell(p, 'Leaf Gilder, art by Quinton Hoover')).toBeVisible();
    expect(art.searches).toEqual(['a:"quinton hoover" is:highres']);
  });

  test('the colour, type and Legendary filters change the request, and quotes in the text are escaped', async ({ page }) => {
    await start(page);
    const p = await openPicker(page);
    await p.getByText('Filters', { exact: true }).click();
    await p.getByRole('checkbox', { name: 'White' }).check();
    await p.getByRole('checkbox', { name: 'Blue' }).check();
    await p.getByRole('checkbox', { name: 'Creature' }).check();
    await p.getByRole('checkbox', { name: 'Instant' }).check();
    await p.getByRole('checkbox', { name: 'Legendary' }).check();
    await search(p, 'delver');
    await expect(cell(p, DUNGEON)).toBeVisible();
    expect(art.searches.at(-1)).toBe('name:"delver" id>=wu (t:creature or t:instant) t:legendary is:highres');

    await p.getByRole('checkbox', { name: 'White' }).uncheck();
    await p.getByRole('checkbox', { name: 'Blue' }).uncheck();
    await p.getByRole('checkbox', { name: 'Colorless' }).check();
    await p.getByRole('checkbox', { name: 'Creature' }).uncheck();
    await p.getByRole('checkbox', { name: 'Legendary' }).uncheck();
    await search(p, 'say "hi"');
    await expect(searchButton(p)).toBeEnabled();
    expect(art.searches.at(-1)).toBe('name:"say" name:"\\"hi\\"" id=c t:instant is:highres');

    // Nothing typed and nothing filtered still gives a grid to start from.
    await p.getByRole('checkbox', { name: 'Colorless' }).uncheck();
    await p.getByRole('checkbox', { name: 'Instant' }).uncheck();
    await search(p, '');
    await expect(searchButton(p)).toBeEnabled();
    expect(art.searches.at(-1)).toBe('game:paper is:highres');
  });

  test('a search that cannot be built shows an inline error tied to the box and sends nothing', async ({ page }) => {
    await start(page);
    const p = await openPicker(page);
    await expect(box(p)).toHaveAttribute('aria-invalid', 'false');
    await search(p, '"');
    await expect(box(p)).toHaveAttribute('aria-invalid', 'true');
    const describedBy = await box(p).getAttribute('aria-describedby');
    await expect(page.locator(`#${describedBy}`)).toContainText('Type a name or artist');
    // A too-long search is refused the same way, before anything is sent.
    await search(p, Array.from({ length: 120 }, () => 'abcdefgh').join(' '));
    await expect(page.locator(`#${describedBy}`)).toContainText('too long');
    await expect(box(p)).toHaveAttribute('aria-invalid', 'true');
    expect(art.searches).toEqual([]);
    // Typing again clears it.
    await box(p).fill('delver');
    await expect(box(p)).toHaveAttribute('aria-invalid', 'false');
    await expect(page.locator(`#${describedBy}`)).toHaveText('');
  });

  test('a query Scryfall refuses (400) shows its message inline and keeps the grid usable', async ({ page }) => {
    await start(page);
    art.answer = (q) => (q.includes('"broken"') ? artReplies['GET /cards/search?q=%28t%3Aelf+is%3Ahighres&unique=art&order=released&page=1'] : null);
    const p = await openPicker(page);
    await search(p, 'broken');
    await expect(box(p)).toHaveAttribute('aria-invalid', 'true');
    const describedBy = await box(p).getAttribute('aria-describedby');
    await expect(page.locator(`#${describedBy}`)).toContainText('unclosed parentheses');
    await expect(searchButton(p)).toBeEnabled();
    await search(p, 'delver');
    await expect(cell(p, DUNGEON)).toBeVisible();
    await expect(box(p)).toHaveAttribute('aria-invalid', 'false');
  });

  test('a search that cannot reach Scryfall says so without marking the box invalid', async ({ page }) => {
    await start(page);
    await page.route('https://api.scryfall.com/cards/search**', (route) => route.abort());
    const p = await openPicker(page);
    await search(p, 'delver');
    await expect(p.getByRole('status').filter({ hasText: "Couldn't reach Scryfall" })).toBeVisible({ timeout: 30_000 });
    await expect(box(p)).toHaveAttribute('aria-invalid', 'false');
    await expect(searchButton(p)).toBeEnabled();
  });

  test('warnings Scryfall returns are shown, not hidden', async ({ page }) => {
    await start(page);
    art.answer = () => artReplies['GET /cards/search?q=name%3A%22delver%22+%28bogus%3Athing%29+is%3Ahighres&unique=art&order=released&page=1'];
    const p = await openPicker(page);
    await search(p, 'delver');
    await expect(cell(p, DUNGEON)).toBeVisible();
    await expect(p.getByRole('status').filter({ hasText: 'Invalid expression “bogus:thing” was ignored' })).toBeVisible();
  });

  test('no match says "No art found"', async ({ page }) => {
    await start(page);
    const p = await openPicker(page);
    await search(p, 'zzzzqq');
    await expect(p.getByRole('status').filter({ hasText: 'No art found' })).toBeVisible();
    await expect(p.locator('.art-cell')).toHaveCount(0);
    await expect(p.getByRole('button', { name: 'Load more' })).toHaveCount(0);
  });

  test('Load more is there only when there is more, and appends', async ({ page }) => {
    await start(page);
    const all = (artReplies['GET /cards/search?q=name%3A%22delver%22+is%3Ahighres&unique=art&order=released&page=1'].body as { data: unknown[] }).data;
    const pages: number[] = [];
    art.answer = (_q, n) => {
      pages.push(n);
      return { status: 200, body: { object: 'list', total_cards: 8, has_more: n === 1, data: n === 1 ? all.slice(0, 4) : all.slice(4, 8) } };
    };
    const p = await openPicker(page);
    await search(p, 'delver');
    await expect(p.locator('.art-cell')).toHaveCount(4);
    const more = p.getByRole('button', { name: 'Load more' });
    await more.click();
    await expect(p.locator('.art-cell')).toHaveCount(7); // 8 cards, one of them without an artist
    await expect(more).toHaveCount(0);
    expect(pages).toEqual([1, 2]);
    // A new search starts again from page 1, and a single page has no Load more.
    art.answer = undefined;
    await search(p, 'delve'); // not 'delver' again: the client keeps a day's replies, and would answer from the paged ones
    await expect(p.locator('.art-cell')).toHaveCount(12);
    await expect(more).toHaveCount(0);
  });

  test('Search is disabled while a search runs, and a reply that arrives after the picker closed changes nothing', async ({ page }) => {
    await start(page);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    let release!: () => void;
    art.gate.search = new Promise<void>((r) => (release = r));
    const p = await openPicker(page);
    await search(p, 'delver');
    await expect(searchButton(p)).toBeDisabled();
    await expect(p.getByRole('status').filter({ hasText: 'Searching' })).toBeVisible();
    // Enter in the box cannot start a second search while one runs.
    await box(p).press('Enter');
    await page.waitForTimeout(300);
    expect(art.searches).toHaveLength(1);

    await page.keyboard.press('Escape');
    await expect(page.locator('dialog.art-picker')).toHaveCount(0);
    const again = await openPicker(page);
    release();
    await page.waitForTimeout(500);
    // The new picker is a fresh one: nothing from the old search landed in it.
    await expect(again.locator('.art-cell')).toHaveCount(0);
    await expect(searchButton(again)).toBeEnabled();
    await expect(again.getByRole('status').filter({ hasText: /Showing|Searching/ })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('the live regions stay in the page when empty', async ({ page }) => {
    await start(page);
    const p = await openPicker(page);
    for (const sel of ['.art-status', '.art-warnings', '.art-note', '.art-error']) {
      const live = p.locator(sel);
      await expect(live).toHaveCount(1);
      await expect(live).toBeEmpty();
      expect(await live.evaluate((e) => getComputedStyle(e).display)).not.toBe('none');
    }
    expect(await page.locator('.player-row .art-note').first().evaluate((e) => getComputedStyle(e).display)).not.toBe('none');
  });

  test('closes when the Life Counter tab is hidden', async ({ page }) => {
    await start(page);
    await openPicker(page);
    await page.evaluate(() => {
      location.hash = '#/browse';
    });
    await expect(page.getByRole('heading', { name: 'Browse' })).toBeVisible();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await page.evaluate(() => {
      location.hash = '#/life/game';
    });
    await expect(tile(page, 0)).toBeVisible();
    // Nothing is left blocking the page.
    await menu(page);
    await expect(page.getByRole('dialog', { name: 'Game menu' })).toBeVisible();
  });
});

test.describe('art on a tile', () => {
  test('picking a cell closes the picker, fills the tile under the scrim, names the credit in the edit row, and is kept for the next game', async ({ page }) => {
    await start(page);
    const before = await tile(page, 0).evaluate((e) => getComputedStyle(e).backgroundColor);
    await pickDungeon(page);
    await expect(page.locator('dialog.art-picker')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Edit players' })).toBeVisible();

    const t = tile(page, 0);
    const fill = t.locator('.tile-art');
    await expect.poll(() => fill.evaluate((e) => getComputedStyle(e).backgroundImage)).toMatch(/^url\("blob:/);
    // Full-bleed: the art covers the whole tile; the other seat is untouched.
    const [a, b] = await Promise.all([fill.boundingBox(), t.boundingBox()]);
    expect(a).toEqual(b);
    await expect(tile(page, 1)).not.toHaveAttribute('data-art', 'true');
    expect(await tile(page, 0).evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(before);
    // Credit is in the edit row, not on the tile.
    await expect(page.locator('.player-row').nth(0)).toContainText('Dungeon Delver · Josh Freydkis');
    await expect(t).not.toContainText('Josh Freydkis');
    await expect(remove(page, 1)).toBeVisible();
    await expect(remove(page, 2)).toHaveCount(0);

    // One fetch saved it; the picked seat's life and buttons still work.
    expect(art.fetches).toHaveLength(1);
    await page.getByRole('dialog', { name: 'Edit players' }).getByRole('button', { name: 'Close' }).click();
    await page.getByRole('dialog', { name: 'Game menu' }).getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Player 1: lose 1 life' }).click();
    await expect(page.locator('.tile[data-player="0"] .tile-life')).toHaveText('39');

    // The next game remembers it, like names and colors.
    await (await menu(page)).getByRole('button', { name: 'New game' }).click();
    await page.getByRole('dialog', { name: 'New game' }).getByRole('button', { name: 'Start' }).click();
    await page.getByRole('button', { name: 'Replace it' }).click();
    await expect(tile(page, 0)).toHaveAttribute('data-art', 'true');
    await expect(tile(page, 0).locator('.tile-life')).toHaveText('40');
    await expect(tile(page, 1)).not.toHaveAttribute('data-art', 'true');
  });

  test('the image is saved: with the network blocked, a reload still shows the art', async ({ page }) => {
    await start(page);
    await pickDungeon(page);
    expect((await cachedRows(page)).length).toBe(1);
    await page.route('https://cards.scryfall.io/**', (route) => route.abort());
    await page.route('https://api.scryfall.com/**', (route) => route.abort());
    await page.reload();
    await expect(tile(page, 0)).toHaveAttribute('data-art', 'true');
    await expect.poll(() => tile(page, 0).locator('.tile-art').evaluate((e) => getComputedStyle(e).backgroundImage)).toMatch(/^url\("blob:/);
  });

  test('text on the tile stays at 4.5:1 or better over the scrim on a pure white image', async ({ page }) => {
    art.image = { body: solidPng(255, 255, 255), type: 'image/png' };
    await start(page);
    await pickDungeon(page);
    await page.getByRole('dialog', { name: 'Edit players' }).getByRole('button', { name: 'Close' }).click();
    await page.getByRole('dialog', { name: 'Game menu' }).getByRole('button', { name: 'Close' }).click();

    const t = tile(page, 0);
    const scrim = await t.locator('.tile-art').evaluate((e) => getComputedStyle(e, '::after').backgroundColor);
    expect(parseColor(scrim)).toMatchObject({ r: 0, g: 0, b: 0 });
    expect(parseColor(scrim).a).toBeCloseTo(SCRIM_ALPHA, 2);
    expect(parseColor(scrim).a).toBeGreaterThanOrEqual(0.6);

    // Each piece of text, over its own background (the buttons are translucent), the scrim and the whitest possible art.
    const parts = await t.evaluate((el) => {
      const pick = (sel: string) => {
        const e = el.querySelector(sel)!;
        return { sel, color: getComputedStyle(e).color, bg: getComputedStyle(e).backgroundColor };
      };
      return ['.tile-life', '.tile-name', '.tile-counters', '.life-btn.minus', '.life-btn.plus'].map(pick);
    });
    const white = 'rgb(255, 255, 255)';
    for (const part of parts) {
      const bg = effectiveBackground([part.bg, scrim, white]);
      const text = parseColor(part.color);
      const over = composite(text, bg);
      expect(contrastRatio(over, bg), part.sel).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('a seat whose image is missing from the cache shows its color, with no broken image', async ({ page }) => {
    await start(page);
    await pickDungeon(page);
    const id = await artId(page, 0);
    expect(id).toBeTruthy();
    await writeRows(page, [{ id: id!, lastUsed: null }]);
    await page.reload();
    await expect(tile(page, 0).locator('.tile-life')).toBeVisible();
    // The record still names the art (it may come back); the tile just has nothing to show.
    await page.waitForTimeout(500);
    await expect(tile(page, 0)).not.toHaveAttribute('data-art', 'true');
    expect(await tile(page, 0).evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(179, 38, 30)');
    await expect(tile(page, 0).locator('img')).toHaveCount(0);
    expect(await tile(page, 0).locator('.tile-art').evaluate((e) => getComputedStyle(e).backgroundImage)).toBe('none');
  });

  test('Remove art returns the seat to its color and is remembered', async ({ page }) => {
    await start(page);
    await pickDungeon(page);
    await remove(page, 1).click();
    await expect(tile(page, 0)).not.toHaveAttribute('data-art', 'true');
    await expect(remove(page, 1)).toHaveCount(0);
    await expect(page.locator('.player-row').nth(0)).toContainText('No art');
    expect(await tile(page, 0).evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(179, 38, 30)');
    await page.getByRole('dialog', { name: 'Edit players' }).getByRole('button', { name: 'Close' }).click();
    await page.getByRole('dialog', { name: 'Game menu' }).getByRole('button', { name: 'Close' }).click();
    await (await menu(page)).getByRole('button', { name: 'New game' }).click();
    await page.getByRole('dialog', { name: 'New game' }).getByRole('button', { name: 'Start' }).click();
    await page.getByRole('button', { name: 'Replace it' }).click();
    await expect(tile(page, 0).locator('.tile-life')).toHaveText('40');
    await expect(tile(page, 0)).not.toHaveAttribute('data-art', 'true');
  });

  test('two seats can show the same art, and changing one leaves the other', async ({ page }) => {
    await start(page);
    await pickDungeon(page, 1);
    await pickDungeon(page, 2);
    await expect.poll(() => tile(page, 1).locator('.tile-art').evaluate((e) => getComputedStyle(e).backgroundImage)).toMatch(/^url\("blob:/);
    await remove(page, 1).click();
    await expect(tile(page, 0)).not.toHaveAttribute('data-art', 'true');
    // The other seat's picture must not have been revoked with the first one's.
    await page.waitForTimeout(300);
    const image = await tile(page, 1).locator('.tile-art').evaluate((e) => getComputedStyle(e).backgroundImage);
    const url = /url\("(.*)"\)/.exec(image)![1];
    const ok = await page.evaluate(async (u) => (await fetch(u)).ok, url);
    expect(ok).toBe(true);
  });

  test('a double tap on a cell saves and applies once', async ({ page }) => {
    await start(page);
    const p = await openPicker(page);
    await search(p, 'delver');
    const c = cell(p, DUNGEON);
    await expect(c).toBeVisible();
    await c.dblclick();
    await expect(tile(page, 0)).toHaveAttribute('data-art', 'true');
    expect(art.fetches).toHaveLength(1);
    expect((await cachedRows(page)).length).toBe(1);
  });

  test('an image that cannot be saved keeps the picker open with a message and leaves the seat alone', async ({ page }) => {
    await start(page);
    art.fail.image = true;
    const p = await openPicker(page);
    await search(p, 'delver');
    await cell(p, DUNGEON).click();
    await expect(p.getByRole('status').filter({ hasText: "Couldn't save that image" })).toBeVisible();
    await expect(p).toBeVisible();
    await expect(tile(page, 0)).not.toHaveAttribute('data-art', 'true');
    expect(await artId(page, 0)).toBeUndefined();
    expect(await cachedRows(page)).toEqual([]);
    // Trying again once the image is reachable works.
    art.fail.image = false;
    await cell(p, DUNGEON).click();
    await expect(tile(page, 0)).toHaveAttribute('data-art', 'true');
    await expect(page.locator('dialog.art-picker')).toHaveCount(0);
  });

  test('a pick still saving when a New game replaces the game is dropped', async ({ page }) => {
    await start(page);
    let release!: () => void;
    art.gate.image = new Promise<void>((r) => (release = r));
    const p = await openPicker(page);
    await search(p, 'delver');
    await cell(p, DUNGEON).click();
    await expect.poll(() => art.fetches.length).toBe(1);
    // The tab changes (closing every dialog), and a New game replaces the game before the image arrives.
    await page.evaluate(() => {
      location.hash = '#/browse';
    });
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await page.evaluate(() => {
      location.hash = '#/life/game';
    });
    await (await menu(page)).getByRole('button', { name: 'New game' }).click();
    await page.getByRole('dialog', { name: 'New game' }).getByRole('button', { name: 'Start' }).click();
    await page.getByRole('button', { name: 'Replace it' }).click();
    await expect(tile(page, 0).locator('.tile-life')).toHaveText('40');
    release();
    await expect.poll(async () => (await cachedRows(page)).length).toBe(1); // the image was saved, harmlessly
    await page.waitForTimeout(300);
    await expect(tile(page, 0)).not.toHaveAttribute('data-art', 'true');
    expect(await artId(page, 0)).toBeUndefined();
    await page.reload();
    await expect(tile(page, 0).locator('.tile-life')).toBeVisible();
    await expect(tile(page, 0)).not.toHaveAttribute('data-art', 'true');
  });

  test('the 25th image evicts the oldest one no seat shows, never one a seat shows', async ({ page }) => {
    await start(page);
    await pickDungeon(page, 1);
    const shown = (await artId(page, 0))!;
    // Make the shown art the oldest in the cache, and fill it to 24 with older-than-new fillers.
    await writeRows(page, [{ id: shown, lastUsed: 1 }, ...Array.from({ length: 23 }, (_, i) => ({ id: `filler-${i}`, lastUsed: 1000 + i }))]);
    expect((await cachedRows(page)).length).toBe(24);

    const p = await openPicker(page, 2);
    await search(p, 'delver');
    await cell(p, 'Dungeon Delver, art by Edgar Sánchez Hidalgo').click();
    await expect(tile(page, 1)).toHaveAttribute('data-art', 'true');
    const second = (await artId(page, 1))!;
    expect(second).not.toBe(shown);
    const ids = (await cachedRows(page)).map((r) => r.id);
    expect(ids).toHaveLength(24);
    expect(ids).toContain(shown); // oldest, but a seat shows it
    expect(ids).toContain(second);
    expect(ids).not.toContain('filler-0'); // the oldest one nobody uses
    expect(ids).toContain('filler-1');
    await expect.poll(() => tile(page, 0).locator('.tile-art').evaluate((e) => getComputedStyle(e).backgroundImage)).toMatch(/^url\("blob:/);
    expect(await lastUsedOf(page, shown)).toBeDefined();
  });

  test('the remembered setup also keeps its art out of eviction', async ({ page }) => {
    await start(page);
    await pickDungeon(page, 1);
    const kept = (await artId(page, 0))!;
    // The seat drops the art, but the next game would still use it (Remove art forgets it, so set the setup by hand).
    await page.evaluate((id) => {
      const saved = JSON.parse(localStorage.getItem('swapsmith:life')!);
      saved.setup.arts = [saved.game.players[0].art, null];
      delete saved.game.players[0].art;
      localStorage.setItem('swapsmith:life', JSON.stringify(saved));
      void id;
    }, kept);
    await page.reload();
    await expect(tile(page, 0).locator('.tile-life')).toBeVisible();
    await writeRows(page, [{ id: kept, lastUsed: 1 }, ...Array.from({ length: 23 }, (_, i) => ({ id: `filler-${i}`, lastUsed: 1000 + i }))]);
    const p = await openPicker(page, 2);
    await search(p, 'delver');
    await cell(p, 'Dungeon Delver, art by Edgar Sánchez Hidalgo').click();
    await expect(tile(page, 1)).toHaveAttribute('data-art', 'true');
    const ids = (await cachedRows(page)).map((r) => r.id);
    expect(ids).toContain(kept);
    expect(ids).not.toContain('filler-0');
  });
});

test.describe('random art', () => {
  test('the dice button applies a random card\'s art at once, with no confirm', async ({ page }) => {
    await start(page);
    await editPlayers(page);
    await random(page, 2).click();
    await expect(tile(page, 1)).toHaveAttribute('data-art', 'true');
    await expect(page.locator('.player-row').nth(1)).toContainText('Ryusei, the Falling Star · Grzegorz Rutkowski');
    await expect(page.getByRole('dialog', { name: 'Edit players' })).toBeVisible();
    await expect(page.locator('dialog.art-picker')).toHaveCount(0);
    expect(art.randoms).toBe(1);
    expect(art.fetches).toHaveLength(1);
    // The status line is empty again once it is done.
    await expect(NOTE(page, 2)).toBeEmpty();
  });

  test('pressing it twice quickly applies one result', async ({ page }) => {
    await start(page);
    await editPlayers(page);
    let release!: () => void;
    art.gate.random = new Promise<void>((r) => (release = r));
    await random(page, 1).evaluate((b: HTMLButtonElement) => {
      b.click();
      b.click();
    });
    // A second dice press, on another seat, is ignored too while the first is still finding its art.
    await random(page, 2).evaluate((b: HTMLButtonElement) => b.click());
    await expect(NOTE(page, 1)).toContainText('Finding art');
    release();
    await expect(tile(page, 0)).toHaveAttribute('data-art', 'true');
    await page.waitForTimeout(300);
    expect(art.randoms).toBe(1);
    expect(art.fetches).toHaveLength(1);
    await expect(tile(page, 1)).not.toHaveAttribute('data-art', 'true');
  });

  test('a failed random says so and keeps the old art', async ({ page }) => {
    await start(page);
    await editPlayers(page);
    await random(page, 1).click();
    await expect(tile(page, 0)).toHaveAttribute('data-art', 'true');
    const old = await artId(page, 0);
    art.fail.random = true;
    await random(page, 1).click();
    await expect(NOTE(page, 1)).toContainText("Couldn't find art, try again");
    await expect(tile(page, 0)).toHaveAttribute('data-art', 'true');
    expect(await artId(page, 0)).toBe(old);
    // And a later success clears the message.
    art.fail.random = false;
    await random(page, 1).click();
    await expect(NOTE(page, 1)).toBeEmpty();
  });

  test('a random image that cannot be saved leaves the seat as it was', async ({ page }) => {
    await start(page);
    await editPlayers(page);
    art.fail.image = true;
    await random(page, 1).click();
    await expect(NOTE(page, 1)).toContainText("Couldn't save that image");
    await expect(tile(page, 0)).not.toHaveAttribute('data-art', 'true');
    expect(await artId(page, 0)).toBeUndefined();
  });
});

test.describe('storage blocked', () => {
  test('the art still applies for the session, with a one-line notice that it will not survive closing the app', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }));
    await start(page);
    await editPlayers(page);
    await random(page, 1).click();
    await expect(tile(page, 0)).toHaveAttribute('data-art', 'true');
    await expect(NOTE(page, 1)).toContainText("won't be kept after you close the app");
    // From the picker too.
    const p = await openPicker(page, 2);
    await search(p, 'delver');
    await cell(p, DUNGEON).click();
    await expect(tile(page, 1)).toHaveAttribute('data-art', 'true');
    await expect(NOTE(page, 2)).toContainText("won't be kept after you close the app");
    // It is shown from Scryfall's image host for now, since there is no saved copy to show.
    expect(await tile(page, 1).locator('.tile-art').evaluate((e) => getComputedStyle(e).backgroundImage)).toMatch(/^url\("https:\/\/cards\.scryfall\.io\//);
    // The next load has nothing to show and falls back to the color.
    await page.reload();
    await expect(tile(page, 1).locator('.tile-life')).toBeVisible();
    await page.waitForTimeout(300);
    await expect(tile(page, 1)).not.toHaveAttribute('data-art', 'true');
  });
});
