import { expect, test, type Locator, type Page } from '@playwright/test';
import { composite, contrastRatio, parseColor, type Rgba } from '../support/contrast';
import { solidPng } from '../support/png';
import { mockArt, type ArtMock } from './helpers';
import { editPlayers, life, menu, minus, plus, start, tile } from './life-helpers';

let art: ArtMock;
test.beforeEach(async ({ page }) => {
  art = await mockArt(page);
  // Counts every time a tile is given data-dying="true", so a test can say "never" without racing the 1.2 s window.
  await page.addInitScript(() => {
    const w = window as unknown as { __dying: number };
    w.__dying = 0;
    new MutationObserver((records) => {
      for (const r of records) if ((r.target as HTMLElement).dataset.dying === 'true') w.__dying += 1;
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-dying'] });
  });
});

const dyingCount = (page: Page) => page.evaluate(() => (window as unknown as { __dying: number }).__dying);
const resetDyingCount = (page: Page) => page.evaluate(() => ((window as unknown as { __dying: number }).__dying = 0));
const dead = (page: Page, seat: number) => expect(tile(page, seat)).toHaveAttribute('data-dead', 'true');
const alive = (page: Page, seat: number) => expect(tile(page, seat)).toHaveAttribute('data-dead', 'false');
const dying = (page: Page, seat: number) => page.locator(`.tile[data-player="${seat}"][data-dying]`);
const settled = (page: Page, seat: number) => expect(dying(page, seat)).toHaveCount(0, { timeout: 2000 });

/** A 2-player game on 1 life: one tap on a seat's minus kills it. */
const oneLife = (page: Page, players = 2) => start(page, { players, custom: '1' });
const sheet = (page: Page, name: string) => page.getByRole('dialog', { name: `${name}: counters` });
const openSheet = async (page: Page, name: string) => {
  await page.getByRole('button', { name: `${name}: poison and commander damage` }).click();
  return sheet(page, name);
};
const closeSheet = async (dlg: Locator) => {
  await dlg.getByRole('button', { name: 'Close' }).click();
  await expect(dlg).toBeHidden();
};
/** Taps a counter's + `times` times in the seat's sheet, then closes it. */
const bump = async (page: Page, name: string, label: string, times: number) => {
  const dlg = await openSheet(page, name);
  for (let i = 0; i < times; i++) await dlg.getByRole('button', { name: `${label}: add 1`, exact: true }).click();
  await closeSheet(dlg);
};
/** Settles after a death and lets every transition finish, so a style read is the resting one. */
const rest = async (page: Page, seat: number) => {
  await dead(page, seat);
  await settled(page, seat);
};
/** Gives seat 1 (0-based seat 0) a pure white art image through the picker. */
async function whiteArt(page: Page) {
  art.image = { body: solidPng(255, 255, 255), type: 'image/png' };
  const dlg = await editPlayers(page);
  await page.getByRole('button', { name: 'Choose art for player 1' }).click();
  const picker = page.getByRole('dialog', { name: 'Art for Player 1' });
  await picker.getByRole('textbox', { name: 'Card name or artist' }).fill('delver');
  await picker.getByRole('button', { name: 'Search', exact: true }).click();
  await picker.getByRole('button', { name: 'Dungeon Delver, art by Josh Freydkis', exact: true }).click();
  await expect(tile(page, 0)).toHaveAttribute('data-art', 'true');
  await dlg.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('dialog', { name: 'Game menu' }).getByRole('button', { name: 'Close' }).click();
}

test.describe('when a seat dies', () => {
  test('every tile says data-dead="false" at the start, nobody is dying, and each tile has one overlay', async ({ page }) => {
    await start(page, { players: 6 });
    expect(await page.locator('.tile').count()).toBe(6);
    expect(await page.locator('.tile[data-dead="false"]').count()).toBe(6);
    expect(await page.locator('.tile[data-dying]').count()).toBe(0);
    expect(await page.locator('.tile .tile-death').count()).toBe(6);
    expect(await dyingCount(page)).toBe(0);
  });

  test('life 0 sets data-dead and data-dying, then data-dying clears within 2 s and data-dead stays', async ({ page }) => {
    await oneLife(page);
    await minus(page, 'Player 1').click();
    await dead(page, 0);
    await expect(dying(page, 0)).toHaveAttribute('data-dying', 'true');
    // The burst really runs: the splatter has an animation, the other tile is untouched.
    expect(await tile(page, 0).locator('.death-splat').evaluate((e) => getComputedStyle(e).animationName)).not.toBe('none');
    await alive(page, 1);
    await settled(page, 0);
    await dead(page, 0);
    expect(await dyingCount(page)).toBe(1);
  });

  test('the dead tile settles on the splatter at .85 and the skull at 1; a living tile shows neither', async ({ page }) => {
    await oneLife(page);
    const opacity = (seat: number, sel: string) => tile(page, seat).locator(sel).evaluate((e) => getComputedStyle(e).opacity);
    expect(await opacity(0, '.death-skull')).toBe('0');
    expect(await opacity(0, '.death-splat')).toBe('0');
    await minus(page, 'Player 1').click();
    await rest(page, 0);
    await expect.poll(() => opacity(0, '.death-skull')).toBe('1');
    await expect.poll(() => opacity(0, '.death-splat')).toBe('0.85');
    expect(await opacity(1, '.death-skull')).toBe('0');
  });

  test('+1 life brings the seat back: data-dead clears and the skull fades out', async ({ page }) => {
    await oneLife(page);
    await minus(page, 'Player 1').click();
    await rest(page, 0);
    await plus(page, 'Player 1').click();
    await alive(page, 0);
    await expect(dying(page, 0)).toHaveCount(0);
    await expect.poll(() => tile(page, 0).locator('.death-skull').evaluate((e) => getComputedStyle(e).opacity)).toBe('0');
    await expect.poll(() => tile(page, 0).locator('.death-splat').evaluate((e) => getComputedStyle(e).opacity)).toBe('0');
  });

  test('healing in the middle of the burst ends it at once', async ({ page }) => {
    await oneLife(page);
    await minus(page, 'Player 1').click();
    await expect(dying(page, 0)).toHaveCount(1);
    await plus(page, 'Player 1').click();
    await alive(page, 0);
    await expect(dying(page, 0)).toHaveCount(0);
  });

  test('die, heal, die again plays the effect each time', async ({ page }) => {
    await oneLife(page);
    await minus(page, 'Player 1').click();
    await rest(page, 0);
    await plus(page, 'Player 1').click();
    await alive(page, 0);
    await minus(page, 'Player 1').click();
    await dead(page, 0);
    await expect(dying(page, 0)).toHaveAttribute('data-dying', 'true');
    await settled(page, 0);
    expect(await dyingCount(page)).toBe(2);
  });

  test('changing counters on a seat that is already dead does not play it again', async ({ page }) => {
    await oneLife(page);
    await minus(page, 'Player 1').click();
    await rest(page, 0);
    await resetDyingCount(page);
    await minus(page, 'Player 1').click(); // life -1
    await bump(page, 'Player 1', 'Poison', 2);
    await page.waitForTimeout(400); // let a wrong replay show itself before the "never" is checked
    await expect(life(page, 0)).toHaveText('-1');
    await dead(page, 0);
    expect(await dyingCount(page)).toBe(0);
    expect(await dying(page, 0).count()).toBe(0);
  });

  test('another seat\'s change does not replay a dead seat either', async ({ page }) => {
    await oneLife(page);
    await minus(page, 'Player 1').click();
    await rest(page, 0);
    await resetDyingCount(page);
    await plus(page, 'Player 2').click();
    await page.waitForTimeout(400);
    expect(await dyingCount(page)).toBe(0);
  });

  test('10 poison kills', async ({ page }) => {
    await start(page);
    await bump(page, 'Player 1', 'Poison', 9);
    await alive(page, 0);
    await bump(page, 'Player 1', 'Poison', 1);
    await dead(page, 0);
    await expect(life(page, 0)).toHaveText('40');
    await settled(page, 0);
  });

  test('21 commander damage from one commander kills, 20 does not', async ({ page }) => {
    await start(page);
    await bump(page, 'Player 1', 'Damage from Player 2', 20);
    await alive(page, 0);
    await bump(page, 'Player 1', 'Damage from Player 2', 1);
    await dead(page, 0);
    await expect(dying(page, 0)).toHaveCount(1);
    await settled(page, 0);
  });

  test('21 commander damage from a partner commander kills', async ({ page }) => {
    await start(page);
    const own = await openSheet(page, 'Player 2');
    await own.getByLabel('Has a partner commander').check();
    await closeSheet(own);
    await bump(page, 'Player 1', "Damage from Player 2's partner", 21);
    await dead(page, 0);
    await alive(page, 1);
    await settled(page, 0);
  });

  test('Undo from dead brings the seat back', async ({ page }) => {
    await oneLife(page);
    await minus(page, 'Player 1').click();
    await rest(page, 0);
    const m = await menu(page);
    await m.getByRole('button', { name: 'Undo' }).click();
    await alive(page, 0);
    await expect(life(page, 0)).toHaveText('1');
    await expect.poll(() => tile(page, 0).locator('.death-skull').evaluate((e) => getComputedStyle(e).opacity)).toBe('0');
  });

  test('Reset life totals clears every dead seat', async ({ page }) => {
    await oneLife(page);
    await minus(page, 'Player 1').click();
    await minus(page, 'Player 2').click();
    await rest(page, 0);
    await rest(page, 1);
    const m = await menu(page);
    await m.getByRole('button', { name: 'Reset life totals' }).click();
    await alive(page, 0);
    await alive(page, 1);
  });

  test('New game starts everyone alive', async ({ page }) => {
    await oneLife(page);
    await minus(page, 'Player 1').click();
    await rest(page, 0);
    await resetDyingCount(page);
    await start(page, { players: 2, life: 40 });
    await alive(page, 0);
    await alive(page, 1);
    await page.waitForTimeout(300);
    expect(await dyingCount(page)).toBe(0);
  });

  test('a saved dead game reloads dead and settled, and never plays the effect on load, reload or a tab switch', async ({ page }) => {
    await oneLife(page);
    await minus(page, 'Player 1').click();
    await rest(page, 0);
    await resetDyingCount(page);
    await page.reload();
    await dead(page, 0);
    await alive(page, 1);
    expect(await tile(page, 0).locator('.death-skull').evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
    // Away to the decks and back redraws the tiles from the saved game.
    await page.evaluate(() => (location.hash = '#/'));
    await page.evaluate(() => (location.hash = '#/life'));
    await dead(page, 0);
    await page.waitForTimeout(500);
    expect(await dyingCount(page)).toBe(0);
    expect(await page.locator('.tile[data-dying]').count()).toBe(0);
    expect(await tile(page, 0).locator('.death-splat').evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
  });
});

test.describe('reduced motion', () => {
  test('the skull and splatter show at once, with no animation and no transition', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await oneLife(page);
    await minus(page, 'Player 1').click();
    await dead(page, 0);
    const read = () =>
      tile(page, 0).evaluate((el) => {
        const pick = (sel: string) => {
          const cs = getComputedStyle(el.querySelector(sel)!);
          return { opacity: cs.opacity, animation: cs.animationName, transition: cs.transitionDuration };
        };
        return { overlay: pick('.tile-death'), splat: pick('.death-splat'), skull: pick('.death-skull'), art: pick('.tile-art') };
      });
    const r = await read();
    expect(r.skull.opacity).toBe('1');
    expect(r.splat.opacity).toBe('0.85');
    for (const part of [r.overlay, r.splat, r.skull]) {
      expect(part.animation).toBe('none');
      expect(part.transition).toMatch(/^0s(, 0s)*$/);
    }
    expect(r.art.transition).toMatch(/^0s(, 0s)*$/);
    await page.waitForTimeout(300);
    expect(await dyingCount(page)).toBe(0);
  });
});

test.describe('how the dead tile looks and behaves', () => {
  test('the overlay is decorative SVG: aria-hidden, no text, no pointer events, no image', async ({ page }) => {
    await oneLife(page);
    const o = tile(page, 0).locator('.tile-death');
    await expect(o).toHaveAttribute('aria-hidden', 'true');
    expect(await o.evaluate((e) => getComputedStyle(e).pointerEvents)).toBe('none');
    expect(await o.evaluate((e) => e.textContent)).toBe('');
    expect(await o.locator('svg').count()).toBe(2);
    expect(await o.locator('img, image, foreignObject, script').count()).toBe(0);
    await minus(page, 'Player 1').click();
    await rest(page, 0);
    expect(await o.evaluate((e) => getComputedStyle(e).pointerEvents)).toBe('none');
    expect(await tile(page, 0).locator('.tile-death').count()).toBe(1);
  });

  test('the life buttons and the Counters button still work on a dead tile', async ({ page }) => {
    await oneLife(page);
    await minus(page, 'Player 1').click();
    await rest(page, 0);
    // A real click, which fails if the overlay covers the button.
    await minus(page, 'Player 1').click();
    await expect(life(page, 0)).toHaveText('-1');
    const hit = await minus(page, 'Player 1').evaluate((b) => {
      const r = b.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return b.contains(top);
    });
    expect(hit).toBe(true);
    await openSheet(page, 'Player 1');
    await expect(sheet(page, 'Player 1')).toBeVisible();
  });

  test('a dead tile with art is greyed and darker; one without art is greyed too', async ({ page }) => {
    await oneLife(page);
    await whiteArt(page);
    await minus(page, 'Player 1').click(); // art
    await minus(page, 'Player 2').click(); // no art
    await rest(page, 0);
    await rest(page, 1);
    for (const seat of [0, 1]) {
      const cs = await tile(page, seat).locator('.tile-art').evaluate((e) => {
        const s = getComputedStyle(e);
        return { filter: s.filter, opacity: s.opacity };
      });
      expect(cs.filter, `seat ${seat}`).toMatch(/grayscale\(1\)/);
      expect(cs.filter).toMatch(/brightness\(0\.\d+\)/);
      expect(cs.opacity).toBe('1');
    }
    // The text is not under the filter: the tile itself, and the number, are not filtered.
    expect(await tile(page, 0).locator('.tile-life').evaluate((e) => getComputedStyle(e).filter)).toBe('none');
    // A living tile has no filter on its art layer.
    await plus(page, 'Player 1').click();
    await expect.poll(() => tile(page, 0).locator('.tile-art').evaluate((e) => getComputedStyle(e).filter)).toBe('none');
  });

  test('a dead tile with a no-art accent keeps its own background until the art layer greys it', async ({ page }) => {
    await oneLife(page);
    const before = await tile(page, 0).evaluate((e) => getComputedStyle(e).backgroundColor);
    await minus(page, 'Player 1').click();
    await rest(page, 0);
    // The accent is still the tile's own colour; the grey comes from the layer over it, and living tiles are not changed.
    expect(await tile(page, 0).evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(before);
    expect(await tile(page, 1).locator('.tile-art').evaluate((e) => getComputedStyle(e).opacity)).toBe('0');
  });

  /** The colours white text can sit on, worst case, on a settled dead tile. */
  async function backgrounds(page: Page, seat: number, base: Rgba): Promise<Array<{ what: string; color: Rgba }>> {
    const read = await tile(page, seat).evaluate((el) => {
      const cs = (e: Element, p?: string) => getComputedStyle(e, p);
      const artEl = el.querySelector('.tile-art')!;
      const fills = (root: string) => [...el.querySelectorAll(`${root} path, ${root} ellipse`)].map((e) => cs(e).fill).filter((f) => f !== 'none');
      return {
        filter: cs(artEl).filter,
        scrim: cs(artEl, '::after').content === 'none' ? null : cs(artEl, '::after').backgroundColor,
        overlay: cs(el.querySelector('.tile-death')!).backgroundColor,
        splat: fills('.death-splat'),
        splatOpacity: cs(el.querySelector('.death-splat')!).opacity,
        skull: fills('.death-skull'),
        skullOpacity: cs(el.querySelector('.death-skull')!).opacity,
      };
    });
    const brightness = Number(/brightness\(([\d.]+)\)/.exec(read.filter)![1]);
    // The scrim sits inside the art layer, so the filter greys the art and scrim together.
    const under = read.scrim ? composite(parseColor(read.scrim), base) : base;
    const grey = Math.min(255, (0.2126 * under.r + 0.7152 * under.g + 0.0722 * under.b) * brightness);
    const art = composite(parseColor(read.overlay), { r: grey, g: grey, b: grey, a: 1 });
    const out = [{ what: 'art under the scrims', color: art }];
    for (const f of new Set(read.splat)) out.push({ what: `splatter ${f}`, color: composite({ ...parseColor(f), a: Number(read.splatOpacity) }, art) });
    for (const f of new Set(read.skull)) out.push({ what: `skull ${f}`, color: composite({ ...parseColor(f), a: Number(read.skullOpacity) }, art) });
    return out;
  }
  async function expectReadable(page: Page, seat: number, base: Rgba) {
    const white = { r: 255, g: 255, b: 255, a: 1 };
    const spots = await backgrounds(page, seat, base);
    expect(spots.length).toBeGreaterThan(4);
    for (const spot of spots) {
      const text = await tile(page, seat).evaluate((el) => [getComputedStyle(el.querySelector('.tile-life')!).color, getComputedStyle(el.querySelector('.tile-name')!).color]);
      for (const c of text) expect(parseColor(c)).toMatchObject({ r: 255, g: 255, b: 255 });
      expect(contrastRatio(white, spot.color), spot.what).toBeGreaterThanOrEqual(4.5);
    }
  }

  test('the life number and name keep 4.5:1 on a dead tile over pure white art', async ({ page }) => {
    await oneLife(page);
    await whiteArt(page);
    await minus(page, 'Player 1').click();
    await rest(page, 0);
    await expectReadable(page, 0, { r: 255, g: 255, b: 255, a: 1 });
  });

  test('the life number and name keep 4.5:1 on a dead tile with no art', async ({ page }) => {
    await oneLife(page);
    await minus(page, 'Player 2').click();
    await rest(page, 1);
    const base = parseColor(await tile(page, 1).evaluate((e) => getComputedStyle(e).backgroundColor));
    await expectReadable(page, 1, base);
  });

  test('a rotated top tile\'s skull and splatter are upright for its player and sit inside the tile', async ({ page }) => {
    await oneLife(page);
    await minus(page, 'Player 2').click(); // seat 1 is the top tile in a 2-player game
    await rest(page, 1);
    const r = await tile(page, 1).evaluate((el) => {
      const box = (sel: string) => el.querySelector(sel)!.getBoundingClientRect().toJSON();
      const o = el.querySelector('.tile-death')!;
      return { tile: el.getBoundingClientRect().toJSON(), skull: box('.death-skull'), splat: box('.death-splat'), overlay: getComputedStyle(o).transform, row: el.closest('.table-row')!.className };
    });
    expect(r.row).toContain('top');
    // A 180 degree turn is matrix(-1, 0, 0, -1, ...): turned, not mirrored (a mirror has one -1 and one 1).
    const m = /^matrix\(([^)]+)\)$/.exec(r.overlay)!;
    const [a, b, c, d] = m[1].split(',').map(Number);
    expect([Math.round(a), Math.round(b), Math.round(c), Math.round(d)]).toEqual([-1, 0, 0, -1]);
    for (const part of [r.skull, r.splat]) {
      expect(part.left).toBeGreaterThanOrEqual(r.tile.left - 0.5);
      expect(part.right).toBeLessThanOrEqual(r.tile.right + 0.5);
      expect(part.top).toBeGreaterThanOrEqual(r.tile.top - 0.5);
      expect(part.bottom).toBeLessThanOrEqual(r.tile.bottom + 0.5);
    }
    // The bottom tile's overlay is not turned.
    await minus(page, 'Player 1').click();
    await rest(page, 0);
    expect(await tile(page, 0).locator('.tile-death').evaluate((e) => getComputedStyle(e).transform)).toBe('none');
  });

  test('six seats: every rotated tile keeps its skull inside, and the life buttons stay in reach', async ({ page }) => {
    await start(page, { players: 6, custom: '1' });
    for (let i = 1; i <= 6; i++) await minus(page, `Player ${i}`).click();
    for (let i = 0; i < 6; i++) await rest(page, i);
    for (let i = 0; i < 6; i++) {
      const r = await tile(page, i).evaluate((el) => ({ tile: el.getBoundingClientRect().toJSON(), skull: el.querySelector('.death-skull')!.getBoundingClientRect().toJSON() }));
      expect(r.skull.left, `seat ${i}`).toBeGreaterThanOrEqual(r.tile.left - 0.5);
      expect(r.skull.right, `seat ${i}`).toBeLessThanOrEqual(r.tile.right + 0.5);
      expect(r.skull.top, `seat ${i}`).toBeGreaterThanOrEqual(r.tile.top - 0.5);
      expect(r.skull.bottom, `seat ${i}`).toBeLessThanOrEqual(r.tile.bottom + 0.5);
    }
    await plus(page, 'Player 3').click();
    await expect(life(page, 2)).toHaveText('1');
  });
});
