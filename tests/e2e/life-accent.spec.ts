import { expect, test, type Locator, type Page } from '@playwright/test';
import { contrastWithWhite } from '../../src/lib/life';
import { readable } from '../../src/lib/art';
import { composite, contrastRatio, effectiveBackground, parseColor } from '../support/contrast';
import { bandsPng, solidPng } from '../support/png';
import { mockArt, type ArtMock } from './helpers';
import { editPlayers, menu, start, tile } from './life-helpers';

// Accent colours for a seat (docs/superpowers/specs/2026-11-13-life-counter-art.md, "Accent colours"): suggested from the
// chosen art, offered and never applied by themselves, beside the palette and a custom colour.

let art: ArtMock;
test.beforeEach(async ({ page }) => {
  art = await mockArt(page);
});

/** Four clearly different colours, one of them (yellow) too light for white text until it is darkened. */
const BANDS = [
  [240, 210, 40],
  [200, 30, 30],
  [30, 30, 200],
  [30, 160, 60],
] as const;
const hexOf = (c: readonly number[]) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const EXPECTED = BANDS.map((c) => readable(hexOf(c))!);

const edit = (page: Page) => page.getByRole('dialog', { name: 'Edit players' });
const suggested = (page: Page, seat = 1) => page.getByRole('group', { name: `Suggested accents for player ${seat}` }).getByRole('button');
const suggestedBoxes = (page: Page, seat = 1) => page.locator('.player-row').nth(seat - 1).locator('.accent-choice');
const custom = (page: Page, seat = 1) => page.getByRole('textbox', { name: `Custom accent for player ${seat}` });
const palette = (page: Page, seat: number, name: string) => page.getByRole('group', { name: `Color for player ${seat}` }).getByRole('button', { name, exact: true });
const accentNote = (page: Page, seat = 1) => page.locator('.player-row').nth(seat - 1).locator('.accent-note');
const savedAccent = (page: Page, seat = 0) => page.evaluate((s) => JSON.parse(localStorage.getItem('swapsmith:life') ?? '{}').game?.players?.[s]?.accent as string | undefined, seat);
const setupAccent = (page: Page, seat = 0) => page.evaluate((s) => JSON.parse(localStorage.getItem('swapsmith:life') ?? '{}').setup?.accents?.[s] as string | null | undefined, seat);
const tileVar = (page: Page, seat = 0) => tile(page, seat).evaluate((e) => (e as HTMLElement).style.getPropertyValue('--tile'));
const rgbOf = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

/** Edit players → seat's Art → search → the first cell; the art is on the tile when this returns. */
async function pickArt(page: Page, seat = 1) {
  if (!(await edit(page).isVisible())) await editPlayers(page);
  await page.getByRole('button', { name: `Choose art for player ${seat}` }).click();
  const p = page.getByRole('dialog', { name: `Art for Player ${seat}` });
  await p.getByRole('textbox', { name: 'Card name or artist' }).fill('delver');
  await p.getByRole('button', { name: 'Search', exact: true }).click();
  await p.getByRole('button', { name: 'Dungeon Delver, art by Josh Freydkis', exact: true }).click();
  await expect(tile(page, seat - 1)).toHaveAttribute('data-art', 'true');
}
const banded = () => (art.image = { body: bandsPng(BANDS), type: 'image/png' });
const closeAll = async (page: Page) => {
  await edit(page).getByRole('button', { name: 'Close' }).click();
  await page.getByRole('dialog', { name: 'Game menu' }).getByRole('button', { name: 'Close' }).click();
};
const hexes = async (loc: Locator) => (await loc.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))).map((l) => l.replace('Accent: ', ''));
const near = (a: string, b: string, tol = 28) => [1, 3, 5].every((i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= tol);

test.describe('suggestions', () => {
  test('after art is picked the seat offers its dominant colours, named by value, readable, and applies none of them', async ({ page }) => {
    banded();
    await start(page);
    const before = await tileVar(page);
    await pickArt(page);
    await expect(suggested(page)).toHaveCount(4);
    const found = await hexes(suggested(page));
    for (const want of EXPECTED) expect(found.some((f) => near(f, want)), `${want} among ${found}`).toBe(true);
    for (const hex of found) {
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(contrastWithWhite(hex), hex).toBeGreaterThanOrEqual(4.5);
    }
    // The light yellow was darkened, not offered as it is.
    expect(found.every((f) => !near(f, hexOf(BANDS[0]), 8))).toBe(true);
    // Beside the palette, with a custom colour field.
    await expect(page.getByRole('group', { name: 'Color for player 1' }).getByRole('button')).toHaveCount(8);
    await expect(custom(page)).toBeVisible();
    // Offered, not applied: nothing pressed, the tile and the save unchanged.
    for (const b of await suggested(page).all()) await expect(b).toHaveAttribute('aria-pressed', 'false');
    expect(await tileVar(page)).toBe(before);
    await page.waitForTimeout(300);
    expect(await savedAccent(page)).toBeUndefined();
    expect(await setupAccent(page)).toBeFalsy();
  });

  test('there are no suggestions before art is chosen, and each seat offers its own', async ({ page }) => {
    banded();
    await start(page);
    await editPlayers(page);
    await expect(page.locator('.accent-choice')).toHaveCount(0);
    await expect(custom(page, 1)).toBeVisible();
    await pickArt(page, 1);
    await expect(suggested(page, 1)).toHaveCount(4);
    await expect(page.locator('.player-row').nth(1).locator('.accent-choice')).toHaveCount(0);
  });

  test('tapping a suggestion sets the accent on the tile border, glow and − / + buttons, and text stays at 4.5:1', async ({ page }) => {
    banded();
    await start(page);
    await pickArt(page);
    const first = suggested(page).nth(1);
    const hex = (await first.getAttribute('aria-label'))!.replace('Accent: ', '');
    await first.click();
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    expect(await suggestedBoxes(page).evaluateAll((els) => els.filter((e) => e.getAttribute('aria-pressed') === 'true').length)).toBe(1);
    for (const b of await page.getByRole('group', { name: 'Color for player 1' }).getByRole('button').all()) await expect(b).toHaveAttribute('aria-pressed', 'false');

    expect(await tileVar(page)).toBe(hex);
    const t = tile(page, 0);
    const css = await t.evaluate((el) => ({
      tile: getComputedStyle(el).boxShadow,
      ring: getComputedStyle(el.querySelector('.tile-art')!, '::after').boxShadow,
      btn: getComputedStyle(el.querySelector('.life-btn.minus')!).backgroundColor,
      btnText: getComputedStyle(el.querySelector('.life-btn.minus')!).color,
      plus: getComputedStyle(el.querySelector('.life-btn.plus')!).backgroundColor,
    }));
    expect(css.tile, 'glow').toContain(rgbOf(hex));
    expect(css.ring, 'border ring').toContain(rgbOf(hex));
    expect(css.btn).toBe(rgbOf(hex));
    expect(css.plus).toBe(rgbOf(hex));
    expect(contrastRatio(parseColor(css.btnText), parseColor(css.btn))).toBeGreaterThanOrEqual(4.5);
    // The row is saved and remembered for the next game.
    await expect.poll(() => savedAccent(page)).toBe(hex);
    expect(await setupAccent(page)).toBe(hex);
  });

  test('an accent on a seat with no art colours the tile itself, text readable on it', async ({ page }) => {
    await start(page);
    await editPlayers(page);
    await custom(page).fill('#2a6f4a');
    await custom(page).press('Enter');
    await expect.poll(() => tile(page, 0).evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(42, 111, 74)');
    const text = await tile(page, 0).locator('.tile-life').evaluate((e) => getComputedStyle(e).color);
    expect(contrastRatio(parseColor(text), parseColor('rgb(42, 111, 74)'))).toBeGreaterThanOrEqual(4.5);
  });

  test('a palette swatch tapped after a suggestion clears the accent', async ({ page }) => {
    banded();
    await start(page);
    await pickArt(page);
    await suggested(page).first().click();
    await expect.poll(() => savedAccent(page)).toBeTruthy();
    await palette(page, 1, 'Blue').click();
    await expect(palette(page, 1, 'Blue')).toHaveAttribute('aria-pressed', 'true');
    for (const b of await suggestedBoxes(page).all()) await expect(b).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => savedAccent(page)).toBeUndefined();
    expect(await setupAccent(page)).toBeFalsy();
    expect(await tileVar(page)).toBe('#1d4e9e');
    await expect(custom(page)).toHaveValue('');
  });

  test('Remove art clears the suggestions but keeps the accent', async ({ page }) => {
    banded();
    await start(page);
    await pickArt(page);
    await suggested(page).nth(2).click();
    await expect.poll(() => savedAccent(page)).toBeTruthy();
    const kept = (await savedAccent(page))!;
    await page.getByRole('button', { name: 'Remove art for player 1' }).click();
    await expect(tile(page, 0)).not.toHaveAttribute('data-art', 'true');
    await expect(page.locator('.accent-choice')).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Suggested accents for player 1' })).toBeHidden();
    expect(await savedAccent(page)).toBe(kept);
    expect(await tileVar(page)).toBe(kept);
  });

  test('new art replaces the suggestions and keeps the accent', async ({ page }) => {
    banded();
    await start(page);
    await pickArt(page);
    await suggested(page).first().click();
    await expect.poll(() => savedAccent(page)).toBeTruthy();
    const kept = (await savedAccent(page))!;
    art.image = { body: bandsPng([[200, 30, 30], [30, 30, 200]]), type: 'image/png' };
    await page.getByRole('button', { name: 'Choose art for player 1' }).click();
    const p = page.getByRole('dialog', { name: 'Art for Player 1' });
    await p.getByRole('textbox', { name: 'Card name or artist' }).fill('delver');
    await p.getByRole('button', { name: 'Search', exact: true }).click();
    await p.getByRole('button', { name: 'Delver of Secrets // Insectile Aberration, art by Florey', exact: true }).click();
    await expect(suggested(page)).toHaveCount(2);
    expect(await savedAccent(page)).toBe(kept);
  });

  test('suggestions are sampled once per image, not each time the dialog opens', async ({ page }) => {
    await page.addInitScript(() => {
      const real = window.createImageBitmap.bind(window);
      (window as unknown as { __bitmaps: number }).__bitmaps = 0;
      window.createImageBitmap = ((...a: Parameters<typeof createImageBitmap>) => {
        (window as unknown as { __bitmaps: number }).__bitmaps += 1;
        return real(...a);
      }) as typeof createImageBitmap;
    });
    banded();
    await start(page);
    await pickArt(page);
    await expect(suggested(page)).toHaveCount(4);
    await closeAll(page);
    await editPlayers(page);
    await expect(suggested(page)).toHaveCount(4);
    await closeAll(page);
    await editPlayers(page);
    await expect(suggested(page)).toHaveCount(4);
    expect(await page.evaluate(() => (window as unknown as { __bitmaps: number }).__bitmaps)).toBe(1);
  });
});

test.describe('custom colour', () => {
  test('a typed colour is applied, saved and remembered', async ({ page }) => {
    await start(page);
    await editPlayers(page);
    await custom(page).fill('#1b6b9e');
    await custom(page).press('Enter');
    await expect.poll(() => savedAccent(page)).toBe('#1b6b9e');
    expect(await setupAccent(page)).toBe('#1b6b9e');
    expect(await tileVar(page)).toBe('#1b6b9e');
    await expect(accentNote(page)).toHaveText('');
    for (const b of await page.getByRole('group', { name: 'Color for player 1' }).getByRole('button').all()) await expect(b).toHaveAttribute('aria-pressed', 'false');
  });

  test('a too-light colour is darkened to a readable one and the row says so', async ({ page }) => {
    await start(page);
    await editPlayers(page);
    await custom(page).fill('#ffff00');
    await custom(page).press('Enter');
    await expect(accentNote(page)).toHaveText('Adjusted so text stays readable');
    const saved = (await savedAccent(page))!;
    expect(saved).not.toBe('#ffff00');
    expect(contrastWithWhite(saved)).toBeGreaterThanOrEqual(4.5);
    await expect(custom(page)).toHaveValue(saved);
    expect(await tileVar(page)).toBe(saved);
    // Typing a readable colour afterwards clears the message.
    await custom(page).fill('#123456');
    await custom(page).press('Enter');
    await expect(accentNote(page)).toHaveText('');
  });

  test('a string that is not a colour is refused: the accent stays, the field says why', async ({ page }) => {
    banded();
    await start(page);
    await pickArt(page);
    await suggested(page).first().click();
    await expect.poll(() => savedAccent(page)).toBeTruthy();
    const kept = (await savedAccent(page))!;
    await custom(page).fill('banana');
    await custom(page).press('Enter');
    await expect(custom(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(accentNote(page)).toContainText('color like #b3261e');
    const described = await custom(page).getAttribute('aria-describedby');
    expect(described).toBeTruthy();
    await expect(page.locator(`#${described}`)).toContainText('color like #b3261e');
    expect(await savedAccent(page)).toBe(kept);
    expect(await tileVar(page)).toBe(kept);
    // Fixing it clears the complaint.
    await custom(page).fill('#336699');
    await custom(page).press('Enter');
    await expect(custom(page)).not.toHaveAttribute('aria-invalid', 'true');
    await expect.poll(() => savedAccent(page)).toBe('#336699');
  });

  test('a string that is not a colour on a seat with no accent keeps what was typed and says why', async ({ page }) => {
    await start(page);
    await editPlayers(page);
    await custom(page).fill('banana');
    await custom(page).press('Enter');
    await expect(custom(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(custom(page)).toHaveValue('banana');
    await expect(accentNote(page)).toHaveText('Enter a color like #b3261e');
    expect(await savedAccent(page)).toBeUndefined();
    await page.waitForTimeout(200);
    expect(await setupAccent(page)).toBeFalsy();
    expect(await tileVar(page)).toBe('#b3261e');
  });

  test('emptying the field leaves the accent alone', async ({ page }) => {
    await start(page);
    await editPlayers(page);
    await custom(page).fill('#336699');
    await custom(page).press('Enter');
    await expect.poll(() => savedAccent(page)).toBe('#336699');
    await custom(page).fill('');
    await custom(page).press('Enter');
    await expect(custom(page)).not.toHaveAttribute('aria-invalid', 'true');
    expect(await savedAccent(page)).toBe('#336699');
  });
});

test.describe('kept', () => {
  test('art and accent survive a reload, a tab switch and a New game', async ({ page }) => {
    banded();
    await start(page);
    await pickArt(page);
    await suggested(page).nth(1).click();
    await expect.poll(() => savedAccent(page)).toBeTruthy();
    const hex = (await savedAccent(page))!;
    await closeAll(page);

    await page.reload();
    await expect(tile(page, 0)).toHaveAttribute('data-art', 'true');
    expect(await tileVar(page)).toBe(hex);

    await page.evaluate(() => (location.hash = '#/browse'));
    await expect(page.getByRole('heading', { name: 'Browse' })).toBeVisible();
    await page.evaluate(() => (location.hash = '#/life/game'));
    await expect(tile(page, 0)).toHaveAttribute('data-art', 'true');
    expect(await tileVar(page)).toBe(hex);

    await (await menu(page)).getByRole('button', { name: 'New game' }).click();
    await page.getByRole('dialog', { name: 'New game' }).getByRole('button', { name: 'Start' }).click();
    await page.getByRole('button', { name: 'Replace it' }).click();
    await expect(tile(page, 0).locator('.tile-life')).toHaveText('40');
    await expect(tile(page, 0)).toHaveAttribute('data-art', 'true');
    expect(await tileVar(page)).toBe(hex);
    // After a reload the suggestions come back from the saved image, with the chosen one pressed.
    await editPlayers(page);
    await expect(suggested(page).first()).toBeVisible();
    await expect(page.locator('.accent-choice[aria-pressed="true"]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: `Accent: ${hex}` })).toHaveAttribute('aria-pressed', 'true');
  });

  test('a custom accent is shown in the field after a reload', async ({ page }) => {
    await start(page);
    await editPlayers(page);
    await custom(page).fill('#336699');
    await custom(page).press('Enter');
    await expect.poll(() => savedAccent(page)).toBe('#336699');
    await page.reload();
    await editPlayers(page);
    await expect(custom(page)).toHaveValue('#336699');
  });
});

test.describe('images with nothing to suggest, and failures', () => {
  const cases: Array<[string, () => void]> = [
    ['a solid black image', () => (art.image = { body: solidPng(0, 0, 0), type: 'image/png' })],
    ['a fully transparent image', () => (art.image = { body: bandsPng([[200, 30, 30, 0]]), type: 'image/png' })],
  ];
  for (const [name, set] of cases) {
    test(`${name} shows no suggestions and the palette still works`, async ({ page }) => {
      set();
      await start(page);
      await pickArt(page);
      await page.waitForTimeout(400);
      await expect(page.locator('.accent-choice')).toHaveCount(0);
      await expect(page.getByRole('group', { name: 'Suggested accents for player 1' })).toBeHidden();
      await palette(page, 1, 'Teal').click();
      await expect(palette(page, 1, 'Teal')).toHaveAttribute('aria-pressed', 'true');
      expect(await tileVar(page)).toBe('#00695c');
    });
  }

  test('sampling that fails (createImageBitmap rejects) shows none and throws nothing', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => {
      window.createImageBitmap = () => Promise.reject(new Error('cannot decode'));
    });
    banded();
    await start(page);
    await pickArt(page);
    await page.waitForTimeout(400);
    await expect(page.locator('.accent-choice')).toHaveCount(0);
    await palette(page, 1, 'Green').click();
    await expect(palette(page, 1, 'Green')).toHaveAttribute('aria-pressed', 'true');
    expect(errors).toEqual([]);
  });

  test('a very large image is sampled from a 32 by 32 copy and still offers its colour, promptly', async ({ page }) => {
    art.image = { body: solidPng(200, 30, 30, 1600), type: 'image/png' };
    await start(page);
    const began = Date.now();
    await pickArt(page);
    await expect(suggested(page)).toHaveCount(1);
    expect(Date.now() - began).toBeLessThan(10_000);
    expect(await hexes(suggested(page))).toEqual(['#c81e1e']);
  });

  test('the tile shows its art at once; suggestions never block it', async ({ page }) => {
    await page.addInitScript(() => {
      window.createImageBitmap = () => new Promise(() => undefined); // never settles
    });
    banded();
    await start(page);
    await pickArt(page);
    await expect.poll(() => tile(page, 0).locator('.tile-art').evaluate((e) => getComputedStyle(e).backgroundImage)).toMatch(/^url\("blob:/);
    await expect(page.locator('.accent-choice')).toHaveCount(0);
    await palette(page, 1, 'Slate').click();
    await expect(palette(page, 1, 'Slate')).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('contrast over bright art', () => {
  test('the Poison badge stays at 4.5:1 over the scrim on a pure white image', async ({ page }) => {
    art.image = { body: solidPng(255, 255, 255), type: 'image/png' };
    await start(page);
    await pickArt(page);
    await closeAll(page);
    await page.getByRole('button', { name: 'Player 1: poison and commander damage' }).click();
    await page.getByRole('button', { name: 'Poison: add 1' }).click();
    await page.getByRole('dialog', { name: 'Player 1: counters' }).getByRole('button', { name: 'Close' }).click();
    const badge = tile(page, 0).locator('.tile-badges .badge', { hasText: 'Poison 1' });
    await expect(badge).toBeVisible();
    const t = tile(page, 0);
    const scrim = await t.locator('.tile-art').evaluate((e) => getComputedStyle(e, '::after').backgroundColor);
    const s = await badge.evaluate((e) => ({ color: getComputedStyle(e).color, bg: getComputedStyle(e).backgroundColor }));
    const bg = effectiveBackground([s.bg, scrim, 'rgb(255, 255, 255)']);
    expect(contrastRatio(composite(parseColor(s.color), bg), bg)).toBeGreaterThanOrEqual(4.5);
  });
});
