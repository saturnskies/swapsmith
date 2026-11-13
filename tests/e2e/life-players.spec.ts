import { expect, test, type Page } from '@playwright/test';
import { life, start } from './life-helpers';

test.beforeEach(async ({ page }) => {
  await page.route('https://api.scryfall.com/**', (route) => route.abort());
});

const tile = (page: Page, seat: number) => page.locator(`.tile[data-player="${seat}"]`);
const bg = (page: Page, seat: number) => tile(page, seat).evaluate((e) => getComputedStyle(e).backgroundColor);
const nameField = (page: Page, n: number) => page.getByLabel(`Name for player ${n}`);
const swatch = (page: Page, n: number, color: string) => page.getByRole('group', { name: `Color for player ${n}` }).getByRole('button', { name: color, exact: true });
const menu = async (page: Page) => {
  await page.getByRole('button', { name: 'Game menu' }).click();
  return page.getByRole('dialog', { name: 'Game menu' });
};
const leave = async (page: Page) => {
  await (await menu(page)).getByRole('link', { name: 'Leave game' }).click();
};
/** Opens Menu → Edit names & colors; the names and colors are set here now, not before the game. */
const editPlayers = async (page: Page) => {
  await (await menu(page)).getByRole('button', { name: 'Edit names & colors' }).click();
  return page.getByRole('dialog', { name: 'Edit players' });
};
/** The edit dialog opens over the menu, so closing it leaves the menu to close too. */
const closeEditing = async (page: Page) => {
  await page.getByRole('dialog', { name: 'Edit players' }).getByRole('button', { name: 'Close' }).click();
  await page.getByRole('dialog', { name: 'Game menu' }).getByRole('button', { name: 'Close' }).click();
};
const newGame = async (page: Page) => {
  await (await menu(page)).getByRole('button', { name: 'New game' }).click();
  await page.getByRole('dialog', { name: 'New game' }).getByRole('button', { name: 'Start' }).click();
  await page.getByRole('button', { name: 'Replace it' }).click();
  await expect(page.getByRole('dialog', { name: 'New game' })).toBeHidden();
};

/** Makes the roll land on a chosen number: the game draws one 32-bit number per roll. */
const fixRandom = (page: Page, n: number) =>
  page.addInitScript((value) => {
    Crypto.prototype.getRandomValues = function <T extends ArrayBufferView | null>(a: T): T {
      (a as unknown as Uint32Array)[0] = value;
      return a;
    };
  }, n);

test.describe('names and colors', () => {
  test('are chosen in the edit dialog, and used on the tiles and in the button names', async ({ page }) => {
    await start(page);
    await editPlayers(page);
    await nameField(page, 1).fill('Alex');
    await swatch(page, 2, 'Blue').click();
    await expect(swatch(page, 2, 'Blue')).toHaveAttribute('aria-pressed', 'true');
    await expect(swatch(page, 2, 'Green')).toHaveAttribute('aria-pressed', 'false');
    await closeEditing(page);

    await expect(tile(page, 0).locator('.tile-name')).toHaveText('Alex');
    await expect(page.getByRole('button', { name: 'Alex: lose 1 life' })).toBeVisible();
    await expect(tile(page, 1).locator('.tile-name')).toHaveText('Player 2');
    expect(await bg(page, 1)).toBe('rgb(29, 78, 158)');
    // The first seat keeps its own default color (red) when none was picked.
    expect(await bg(page, 0)).toBe('rgb(179, 38, 30)');
  });

  test('a name is cut to 24 characters', async ({ page }) => {
    await start(page, { players: 1 });
    await editPlayers(page);
    await nameField(page, 1).fill('x'.repeat(40));
    await closeEditing(page);
    await expect(tile(page, 0).locator('.tile-name')).toHaveText('x'.repeat(24));
  });

  test('are remembered for the next game', async ({ page }) => {
    // A new game starts from the saved defaults (2 players), with each seat's name and color from the last edit.
    await start(page);
    await editPlayers(page);
    await nameField(page, 2).fill('Blake');
    await swatch(page, 2, 'Teal').click();
    await closeEditing(page);
    await newGame(page);
    await expect(tile(page, 1).locator('.tile-name')).toHaveText('Blake');
    expect(await bg(page, 1)).toBe('rgb(0, 105, 92)');
    await expect(tile(page, 0).locator('.tile-name')).toHaveText('Player 1');

    await page.reload();
    await expect(tile(page, 1).locator('.tile-name')).toHaveText('Blake');
    expect(await bg(page, 1)).toBe('rgb(0, 105, 92)');
  });

  test('can be edited during the game, and everything that shows a name follows', async ({ page }) => {
    await start(page, { players: 3 });
    const dlg = await menu(page);
    await dlg.getByRole('button', { name: 'Edit names & colors' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit players' });
    await edit.getByLabel('Name for player 2').fill('Blake');
    await edit.getByRole('group', { name: 'Color for player 3' }).getByRole('button', { name: 'Purple', exact: true }).click();
    await expect(tile(page, 1).locator('.tile-name')).toHaveText('Blake');
    await expect(page.getByRole('button', { name: 'Blake: lose 1 life', includeHidden: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Player 2: lose 1 life', includeHidden: true })).toHaveCount(0);
    expect(await bg(page, 2)).toBe('rgb(107, 63, 160)');

    // Blank gives the default back, and the change is saved.
    await edit.getByLabel('Name for player 2').fill('');
    await expect(tile(page, 1).locator('.tile-name')).toHaveText('Player 2');
    await edit.getByLabel('Name for player 2').fill('Blake');
    await edit.getByRole('button', { name: 'Close' }).click();
    await dlg.getByRole('button', { name: 'Close' }).click();
    await page.reload();
    await expect(tile(page, 1).locator('.tile-name')).toHaveText('Blake');
    expect(await bg(page, 2)).toBe('rgb(107, 63, 160)');
  });

  test('a renamed opponent shows under their new name in the commander damage rows', async ({ page }) => {
    await start(page, { players: 2 });
    await editPlayers(page);
    await nameField(page, 2).fill('Blake');
    await closeEditing(page);
    await page.getByRole('button', { name: 'Player 1: poison and commander damage' }).click();
    await expect(page.getByRole('group', { name: 'Damage from Blake', exact: true })).toBeVisible();
  });
});

test.describe('roll for first player', () => {
  test('picks a player at random, marks them, and keeps the mark through a reload', async ({ page }) => {
    await fixRandom(page, 2);
    await start(page, { players: 3 });
    await expect(page.locator('.tile[data-first="true"]')).toHaveCount(0);
    await (await menu(page)).getByRole('button', { name: 'Roll for first player' }).click();
    await expect(tile(page, 2)).toHaveAttribute('data-first', 'true');
    await expect(tile(page, 2).locator('.tile-badges')).toContainText('Goes first');
    await expect(page.locator('.tile[data-first="true"]')).toHaveCount(1);

    await page.reload();
    await expect(tile(page, 2)).toHaveAttribute('data-first', 'true');
  });

  test('rolls again for a different player, and a reset clears the mark', async ({ page }) => {
    await fixRandom(page, 0);
    await start(page, { players: 3 });
    await (await menu(page)).getByRole('button', { name: 'Roll for first player' }).click();
    await expect(tile(page, 0)).toHaveAttribute('data-first', 'true');

    const dlg = await menu(page);
    await dlg.getByRole('button', { name: 'Reset life totals' }).click();
    await page.getByRole('dialog', { name: 'Reset all life totals?' }).getByRole('button', { name: 'Reset' }).click();
    await expect(page.locator('.tile[data-first="true"]')).toHaveCount(0);
  });

  test('shows the roll moving between tiles, unless reduced motion is asked for', async ({ page }) => {
    await fixRandom(page, 1);
    await start(page, { players: 3 });
    await (await menu(page)).getByRole('button', { name: 'Roll for first player' }).click();
    await expect(page.locator('.tile.rolling')).toHaveCount(1);
    await expect(tile(page, 1)).toHaveAttribute('data-first', 'true');
    await expect(page.locator('.tile.rolling')).toHaveCount(0);
  });

  test('the menu stays shut while the roll runs, so nothing can reset or undo mid-roll', async ({ page }) => {
    await fixRandom(page, 5);
    await start(page, { players: 6 });
    await (await menu(page)).getByRole('button', { name: 'Roll for first player' }).click();
    await expect(page.getByRole('button', { name: 'Game menu' })).toBeDisabled();
    await expect(tile(page, 5)).toHaveAttribute('data-first', 'true');
    await expect(page.getByRole('button', { name: 'Game menu' })).toBeEnabled();
  });

  test('a roll still running when you visit another tab finishes once: one player marked and saved, none doubled on return', async ({ page }) => {
    await fixRandom(page, 5);
    await start(page, { players: 6 });
    await (await menu(page)).getByRole('button', { name: 'Roll for first player' }).click();
    await expect(page.locator('.tile.rolling')).toHaveCount(1);
    await page.evaluate(() => (location.hash = '#/'));
    await page.waitForTimeout(2600);
    await page.evaluate(() => (location.hash = '#/life'));
    await expect(page).toHaveURL(/#\/life\/game$/);
    await expect(page.locator('.tile[data-first="true"]')).toHaveCount(1);
    await expect(tile(page, 5)).toHaveAttribute('data-first', 'true');
    await expect(page.locator('.tile.rolling')).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('swapsmith:life')!).game.first)).toBe(5);
  });

  test('with reduced motion the answer is shown at once, with no animation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await fixRandom(page, 1);
    await start(page, { players: 3 });
    await page.evaluate(() => {
      (window as unknown as { seen: number }).seen = 0;
      new MutationObserver(() => {
        if (document.querySelector('.tile.rolling')) (window as unknown as { seen: number }).seen++;
      }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
    });
    await (await menu(page)).getByRole('button', { name: 'Roll for first player' }).click();
    await expect(tile(page, 1)).toHaveAttribute('data-first', 'true', { timeout: 400 });
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => (window as unknown as { seen: number }).seen)).toBe(0);
  });

  test('with one player there is nothing to roll, and they go first at once', async ({ page }) => {
    await start(page, { players: 1 });
    await (await menu(page)).getByRole('button', { name: 'Roll for first player' }).click();
    await expect(tile(page, 0)).toHaveAttribute('data-first', 'true', { timeout: 400 });
  });
});

/** A stand-in for navigator.wakeLock that counts what the game asks of it. */
const stubWakeLock = (page: Page, mode: 'works' | 'rejects' | 'missing') =>
  page.addInitScript((m) => {
    const w = window as unknown as { wl: { requests: number; released: number; sentinels: EventTarget[] } };
    w.wl = { requests: 0, released: 0, sentinels: [] };
    const api =
      m === 'missing'
        ? undefined
        : {
            request: async () => {
              w.wl.requests++;
              if (m === 'rejects') throw new DOMException('no', 'NotAllowedError');
              const s = new EventTarget() as EventTarget & { release(): Promise<void> };
              s.release = async () => {
                w.wl.released++;
                s.dispatchEvent(new Event('release'));
              };
              w.wl.sentinels.push(s);
              return s;
            },
          };
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: api });
  }, mode);
const wl = (page: Page) => page.evaluate(() => (window as unknown as { wl: { requests: number; released: number } }).wl);

test.describe('keep the screen awake', () => {
  test('asks for the lock when the game opens and lets go when you leave it', async ({ page }) => {
    await stubWakeLock(page, 'works');
    await page.goto('./');
    expect((await wl(page)).requests).toBe(0);
    await start(page);
    await expect.poll(async () => (await wl(page)).requests).toBe(1);
    await leave(page);
    await expect.poll(async () => (await wl(page)).released).toBe(1);
  });

  test('lets go when you leave by another route, and asks again when you come back to the game', async ({ page }) => {
    await stubWakeLock(page, 'works');
    await start(page);
    await expect.poll(async () => (await wl(page)).requests).toBe(1);
    await page.evaluate(() => (location.hash = '#/browse'));
    await expect.poll(async () => (await wl(page)).released).toBe(1);
    await page.evaluate(() => (location.hash = '#/life/game'));
    await expect.poll(async () => (await wl(page)).requests).toBe(2);
  });

  test('asks again after the system drops the lock, and never holds two', async ({ page }) => {
    await stubWakeLock(page, 'works');
    await start(page);
    await expect.poll(async () => (await wl(page)).requests).toBe(1);

    // Coming back to the page while a lock is held asks for nothing more.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(200);
    expect((await wl(page)).requests).toBe(1);

    // The system takes the lock away (as it does when the page is hidden); coming back asks again.
    await page.evaluate(() => (window as unknown as { wl: { sentinels: EventTarget[] } }).wl.sentinels[0].dispatchEvent(new Event('release')));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(async () => (await wl(page)).requests).toBe(2);
  });

  for (const mode of ['rejects', 'missing'] as const) {
    test(`says the screen may turn off when the lock is ${mode === 'rejects' ? 'refused' : 'not available'}, and the game still works`, async ({ page }) => {
      await stubWakeLock(page, mode);
      await start(page);
      await page.getByRole('button', { name: 'Player 1: lose 1 life' }).click();
      await expect(life(page, 0)).toHaveText('39');
      const dlg = await menu(page);
      await expect(dlg.getByText('Your screen may turn off during the game.')).toBeVisible();
    });
  }

  test('says nothing when the lock is held', async ({ page }) => {
    await stubWakeLock(page, 'works');
    await start(page);
    await expect.poll(async () => (await wl(page)).requests).toBe(1);
    const dlg = await menu(page);
    await expect(dlg.getByText('Your screen may turn off')).toHaveCount(0);
  });
});
