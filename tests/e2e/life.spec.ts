import { expect, test, type Locator, type Page } from '@playwright/test';
import { life, menu, minus, plus, start } from './life-helpers';

test.beforeEach(async ({ page }) => {
  await page.route('https://api.scryfall.com/**', (route) => route.abort());
});

const pressed = (page: Page, group: string, name: string) => page.getByRole('group', { name: group }).getByRole('button', { name, exact: true });
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('swapsmith:life') ?? 'null'));
const openSheet = async (page: Page, action: 'New game' | 'Defaults') => {
  await (await menu(page)).getByRole('button', { name: action }).click();
  return page.getByRole('dialog', { name: action });
};
const SAVE = 'Save defaults';

/** An empty live region stays in the accessibility tree: a 1px clipped box taken out of the layout, never display:none. */
const liveBox = (el: Locator) =>
  el.evaluate((node) => {
    const cs = getComputedStyle(node);
    const r = node.getBoundingClientRect();
    return { text: node.textContent, role: node.getAttribute('role'), display: cs.display, position: cs.position, w: r.width, h: r.height };
  });
const clippedStatus = { text: '', role: 'status', display: expect.not.stringMatching(/^none$/), position: 'absolute', w: 1, h: 1 };

test.describe('opening', () => {
  test('a fresh profile opens straight into a 2-player, 40-life game, full screen, with no setup step', async ({ page }) => {
    await page.goto('./#/life');
    await expect(page).toHaveURL(/#\/life\/game$/);
    await expect(page.locator('.tile')).toHaveCount(2);
    await expect(life(page, 0)).toHaveText('40');
    await expect(life(page, 1)).toHaveText('40');
    await expect(page.getByRole('button', { name: /Start game/ })).toHaveCount(0);
    await expect(page.getByText('Start game')).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
    await expect(page.locator('.site-header')).toBeHidden();
  });

  test('nothing is saved until the Life Counter is first shown, then the default game is saved once', async ({ page }) => {
    await page.goto('./');
    await expect(page.getByRole('heading', { name: 'Your decks' })).toBeVisible();
    expect(await stored(page)).toBeNull();
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Life Counter' }).click();
    await expect(page.locator('.tile')).toHaveCount(2);
    const first = await stored(page);
    expect(first.game.players).toHaveLength(2);
    expect(first.defaults).toEqual({ players: 2, startingLife: 40 });
    // Showing the tab again (a second ensureGame) leaves the same game, not a fresh one.
    await minus(page, 'Player 1').click();
    await page.evaluate(() => (location.hash = '#/'));
    await page.evaluate(() => (location.hash = '#/life'));
    await expect(life(page, 0)).toHaveText('39');
    expect((await stored(page)).game.players[0].life).toBe(39);
  });

  test('tapping the Life Counter tab from Decks lands on the game', async ({ page }) => {
    await page.goto('./');
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Life Counter' }).click();
    await expect(page).toHaveURL(/#\/life\/game$/);
    await expect(page.locator('.tile')).toHaveCount(2);
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
  });

  test('a life total is kept across a visit to Decks and a reload', async ({ page }) => {
    await start(page);
    await minus(page, 'Player 1').click();
    await page.evaluate(() => (location.hash = '#/'));
    await expect(page.getByRole('heading', { name: 'Your decks' })).toBeVisible();
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Life Counter' }).click();
    await expect(life(page, 0)).toHaveText('39');
    await page.reload();
    await expect(page).toHaveURL(/#\/life\/game$/);
    await expect(life(page, 0)).toHaveText('39');
  });

  test('Leave game goes to Decks, with the game kept', async ({ page }) => {
    await start(page);
    await minus(page, 'Player 2').click();
    await (await menu(page)).getByRole('link', { name: 'Leave game' }).click();
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.getByRole('heading', { name: 'Your decks' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    expect((await stored(page)).game.players[1].life).toBe(39);
  });

  test('a store from the old app (4 players set up, a live game, no defaults) still opens that game; New game then uses the 2-player default', async ({ page }) => {
    const player = (name: string, life: number, color: number) => ({ name, life, poison: 0, color, partners: false, cmdr: {} });
    const old = {
      version: 1,
      game: { startingLife: 40, players: [player('Ann', 33, 0), player('Bo', 40, 1), player('Cy', 12, 2), player('Di', 40, 3)], history: [], first: null },
      setup: { players: 4, startingLife: 40, names: ['Ann', 'Bo', 'Cy', 'Di'], colors: [0, 1, 2, 3] },
    };
    await page.addInitScript((raw) => {
      if (!localStorage.getItem('swapsmith:life')) localStorage.setItem('swapsmith:life', raw);
    }, JSON.stringify(old));
    await page.goto('./#/life');
    await expect(page.locator('.tile')).toHaveCount(4);
    await expect(life(page, 0)).toHaveText('33');
    await expect(life(page, 2)).toHaveText('12');

    await openSheet(page, 'New game');
    await expect(pressed(page, 'Players', '2')).toHaveAttribute('aria-pressed', 'true');
    await expect(pressed(page, 'Starting life', '40')).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('dialog', { name: 'New game' }).getByRole('button', { name: 'Start' }).click();
    await page.getByRole('button', { name: 'Replace it' }).click();
    await expect(page.locator('.tile')).toHaveCount(2);
    // Names from the old setup carry over by seat.
    await expect(page.locator('.tile[data-player="0"] .tile-name')).toHaveText('Ann');
  });
});

test.describe('Defaults sheet', () => {
  test('its empty notice stays in the accessibility tree as a 1px clipped box', async ({ page }) => {
    await start(page);
    const dlg = await openSheet(page, 'Defaults');
    const notice = dlg.locator('.notice');
    await expect(notice).toHaveCount(1);
    expect(await liveBox(notice)).toEqual(clippedStatus);
  });

  test('saved players and starting life apply to the next New game and leave the game in progress alone', async ({ page }) => {
    await start(page);
    await minus(page, 'Player 1').click();
    const dlg = await openSheet(page, 'Defaults');
    await expect(pressed(page, 'Players', '2')).toHaveAttribute('aria-pressed', 'true');
    await expect(pressed(page, 'Starting life', '40')).toHaveAttribute('aria-pressed', 'true');
    await pressed(page, 'Players', '4').click();
    await pressed(page, 'Starting life', '30').click();
    await dlg.getByRole('button', { name: SAVE }).click();
    await expect(dlg.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
    await dlg.getByRole('button', { name: 'Close' }).click();

    await expect(page.locator('.tile')).toHaveCount(2);
    await expect(life(page, 0)).toHaveText('39');
    expect((await stored(page)).defaults).toEqual({ players: 4, startingLife: 30 });

    await openSheet(page, 'New game');
    await expect(pressed(page, 'Players', '4')).toHaveAttribute('aria-pressed', 'true');
    await expect(pressed(page, 'Starting life', '30')).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('dialog', { name: 'New game' }).getByRole('button', { name: 'Start' }).click();
    await page.getByRole('button', { name: 'Replace it' }).click();
    await expect(page.locator('.tile')).toHaveCount(4);
    for (const seat of [0, 1, 2, 3]) await expect(life(page, seat)).toHaveText('30');

    // The defaults survive a reload.
    await page.reload();
    await openSheet(page, 'Defaults');
    await expect(pressed(page, 'Players', '4')).toHaveAttribute('aria-pressed', 'true');
  });

  test('the Saved note is there, empty, before saving, and clears when the form changes', async ({ page }) => {
    await start(page);
    const dlg = await openSheet(page, 'Defaults');
    const note = page.locator('.saved-note');
    await expect(note).toHaveCount(1);
    await expect(note).toHaveText('');
    await expect(note).toHaveAttribute('role', 'status');
    await dlg.getByRole('button', { name: SAVE }).click();
    await expect(note).toHaveText('Saved');
    await pressed(page, 'Players', '5').click();
    await expect(note).toHaveText('');
  });

  test("Use this game's setup copies the current players and life into the form", async ({ page }) => {
    await start(page, { players: 3, life: 20 });
    const dlg = await openSheet(page, 'Defaults');
    await expect(pressed(page, 'Players', '2')).toHaveAttribute('aria-pressed', 'true');
    await dlg.getByRole('button', { name: "Use this game's setup" }).click();
    await expect(pressed(page, 'Players', '3')).toHaveAttribute('aria-pressed', 'true');
    await expect(pressed(page, 'Starting life', '20')).toHaveAttribute('aria-pressed', 'true');
    // Copying only fills the form; nothing is saved until Save defaults.
    expect((await stored(page)).defaults).toEqual({ players: 2, startingLife: 40 });
    await dlg.getByRole('button', { name: SAVE }).click();
    expect((await stored(page)).defaults).toEqual({ players: 3, startingLife: 20 });
  });

  test("Use this game's setup copies a custom starting life into the Custom field", async ({ page }) => {
    await start(page, { players: 2, custom: '25' });
    const dlg = await openSheet(page, 'Defaults');
    await dlg.getByRole('button', { name: "Use this game's setup" }).click();
    await expect(pressed(page, 'Starting life', 'Custom')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Custom starting life')).toHaveValue('25');
    await expect(dlg.getByRole('button', { name: SAVE })).toBeEnabled();
  });

  test('submitting the form while it is invalid saves nothing', async ({ page }) => {
    await start(page);
    const dlg = await openSheet(page, 'Defaults');
    await pressed(page, 'Starting life', 'Custom').click();
    await page.getByLabel('Custom starting life').fill('0');
    await expect(dlg.getByRole('button', { name: SAVE })).toBeDisabled();
    await dlg.locator('form').evaluate((f) => (f as HTMLFormElement).requestSubmit());
    await page.waitForTimeout(200);
    expect((await stored(page)).defaults).toEqual({ players: 2, startingLife: 40 });
    await expect(page.locator('.saved-note')).toHaveText('');
  });
});

test.describe('New game sheet', () => {
  test('its empty notice stays in the accessibility tree as a 1px clipped box', async ({ page }) => {
    await start(page);
    const dlg = await openSheet(page, 'New game');
    const notice = dlg.locator('.notice');
    await expect(notice).toHaveCount(1);
    expect(await liveBox(notice)).toEqual(clippedStatus);
  });

  test('asks before replacing: Keep current game leaves it, Replace it starts a fresh one from the form', async ({ page }) => {
    await start(page);
    await minus(page, 'Player 1').click();
    const dlg = await openSheet(page, 'New game');
    await pressed(page, 'Players', '3').click();
    await dlg.getByRole('button', { name: 'Start' }).click();
    const ask = page.getByRole('dialog', { name: 'Replace the game in progress?' });
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Keep current game' }).click();
    await expect(ask).toBeHidden();
    await dlg.getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('.tile')).toHaveCount(2);
    await expect(life(page, 0)).toHaveText('39');

    await openSheet(page, 'New game');
    await pressed(page, 'Players', '3').click();
    await page.getByRole('dialog', { name: 'New game' }).getByRole('button', { name: 'Start' }).click();
    await page.getByRole('dialog', { name: 'Replace the game in progress?' }).getByRole('button', { name: 'Replace it' }).click();
    await expect(page.locator('.tile')).toHaveCount(3);
    for (const seat of [0, 1, 2]) await expect(life(page, seat)).toHaveText('40');
    expect((await stored(page)).game.players).toHaveLength(3);
  });

  test('starts from the defaults, and changing it does not change them', async ({ page }) => {
    await start(page, { players: 5, life: 20 });
    await expect(page.locator('.tile')).toHaveCount(5);
    expect((await stored(page)).defaults).toEqual({ players: 2, startingLife: 40 });
    await openSheet(page, 'New game');
    await expect(pressed(page, 'Players', '2')).toHaveAttribute('aria-pressed', 'true');
    await expect(pressed(page, 'Starting life', '40')).toHaveAttribute('aria-pressed', 'true');
  });

  test('the game replaced for good is a whole new one: totals, counters and Undo history are gone', async ({ page }) => {
    await start(page);
    await minus(page, 'Player 1').click();
    await page.getByRole('button', { name: 'Player 2: poison and commander damage' }).click();
    await page.getByRole('dialog', { name: 'Player 2: counters' }).getByRole('button', { name: 'Poison: add 1', exact: true }).click();
    await page.getByRole('dialog', { name: 'Player 2: counters' }).getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('.tile-badges', { hasText: 'Poison 1' })).toHaveCount(1);
    await start(page, { players: 2 });
    await expect(life(page, 0)).toHaveText('40');
    await expect(page.locator('.tile-badges', { hasText: 'Poison' })).toHaveCount(0);
    expect((await stored(page)).game.history).toEqual([]);
  });

  test('a question left open does not outlive a visit elsewhere, and the game is untouched', async ({ page }) => {
    await start(page);
    await minus(page, 'Player 1').click();
    const dlg = await openSheet(page, 'New game');
    await dlg.getByRole('button', { name: 'Start' }).click();
    await expect(page.getByRole('dialog', { name: 'Replace the game in progress?' })).toBeVisible();
    await page.evaluate(() => (location.hash = '#/'));
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await page.evaluate(() => (location.hash = '#/life'));
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(life(page, 0)).toHaveText('39');
    expect((await stored(page)).game.players[0].life).toBe(39);
  });

  test('a double tap on the menu actions opens one sheet, not two', async ({ page }) => {
    await start(page);
    const m = await menu(page);
    await expect(m).toBeVisible();
    await page.evaluate(() => {
      const btn = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('dialog[open] button')].find((b) => b.textContent === name)!;
      const a = btn('New game');
      a.click();
      a.click();
    });
    await expect(page.locator('dialog[aria-labelledby="newgame-h"]')).toHaveCount(1);
    await page.evaluate(() => {
      const d = [...document.querySelectorAll<HTMLButtonElement>('dialog button')].find((b) => b.textContent === 'Defaults')!;
      d.click();
    });
    await expect(page.locator('dialog[aria-labelledby="defaults-h"]')).toHaveCount(0);
    await expect(page.locator('dialog[open]')).toHaveCount(1);
  });
});

for (const sheet of ['New game', 'Defaults'] as const) {
  test(`${sheet}: a custom starting life takes whole numbers from 1 to 999 only, said to assistive tech too`, async ({ page }) => {
    await start(page);
    const dlg = await openSheet(page, sheet);
    const go = dlg.getByRole('button', { name: sheet === 'New game' ? 'Start' : SAVE });
    await pressed(page, 'Starting life', 'Custom').click();
    const field = page.getByLabel('Custom starting life');
    const hint = dlg.locator('.life-hint');
    for (const bad of ['0', '1000', 'abc', '12.5', '']) {
      await field.fill(bad);
      await expect(go).toBeDisabled();
      await expect(field).toHaveAttribute('aria-invalid', 'true');
      await expect(hint).toHaveText('Enter a whole number from 1 to 999.');
      await expect(hint).toBeVisible();
      await expect(hint).toHaveAttribute('role', 'status');
      await expect(field).toHaveAttribute('aria-describedby', (await hint.getAttribute('id'))!);
    }
    for (const good of ['1', '999']) {
      await field.fill(good);
      await expect(go).toBeEnabled();
      await expect(field).toHaveAttribute('aria-invalid', 'false');
      await expect(hint).toHaveText('');
    }
  });
}

test('a custom starting life starts the game at that life', async ({ page }) => {
  await start(page, { players: 2, custom: '25' });
  await expect(life(page, 0)).toHaveText('25');
  await expect(life(page, 1)).toHaveText('25');
});

test('tap changes life by one, from the player\'s own buttons', async ({ page }) => {
  await start(page, { players: 2 });
  await minus(page, 'Player 1').click();
  await minus(page, 'Player 1').click();
  await plus(page, 'Player 2').click();
  await expect(life(page, 0)).toHaveText('38');
  await expect(life(page, 1)).toHaveText('41');
});

test('keyboard: Enter changes by one, Shift+Enter by ten', async ({ page }) => {
  await start(page, { players: 1 });
  await minus(page, 'Player 1').focus();
  await page.keyboard.press('Enter');
  await expect(life(page, 0)).toHaveText('39');
  await page.keyboard.press('Shift+Enter');
  await expect(life(page, 0)).toHaveText('29');
});

test('hold changes life by ten, once, and the release does not also tap', async ({ page }) => {
  await start(page, { players: 2 });
  const btn = minus(page, 'Player 1');
  const box = (await btn.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForTimeout(300);
  await expect(life(page, 0)).toHaveText('30');

  const up = plus(page, 'Player 1');
  const ub = (await up.boundingBox())!;
  await page.mouse.move(ub.x + ub.width / 2, ub.y + ub.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForTimeout(300);
  await expect(life(page, 0)).toHaveText('40');
});

test('a press that leaves the button before the hold registers changes nothing', async ({ page }) => {
  await start(page, { players: 2 });
  const box = (await minus(page, 'Player 1').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 200);
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForTimeout(300);
  await expect(life(page, 0)).toHaveText('40');
});

test('two players holding at once each change only their own total', async ({ page }) => {
  await start(page, { players: 2 });
  const a = minus(page, 'Player 1');
  const b = plus(page, 'Player 2');
  await a.dispatchEvent('pointerdown', { pointerId: 1, button: 0 });
  await b.dispatchEvent('pointerdown', { pointerId: 2, button: 0 });
  await page.waitForTimeout(700);
  await a.dispatchEvent('pointerup', { pointerId: 1, button: 0 });
  await b.dispatchEvent('pointerup', { pointerId: 2, button: 0 });
  await expect(life(page, 0)).toHaveText('30');
  await expect(life(page, 1)).toHaveText('50');
});

test.describe('seating', () => {
  const layouts: Array<[number, number[], number[]]> = [
    [1, [], [0]],
    [2, [1], [0]],
    [3, [1], [0, 2]],
    [4, [1, 2], [0, 3]],
    [5, [1, 2], [0, 4, 3]],
    [6, [1, 2, 3], [0, 5, 4]],
  ];
  for (const [n, top, bottom] of layouts) {
    test(`${n} player${n > 1 ? 's' : ''}: top row ${JSON.stringify(top)}, bottom row ${JSON.stringify(bottom)}`, async ({ page }) => {
      await start(page, { players: n });
      const seats = (row: string) => page.locator(`.table-row.${row} .tile`).evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.player)));
      expect(await seats('top')).toEqual(top);
      expect(await seats('bottom')).toEqual(bottom);
      // Top-row tiles are turned upside down for the people sitting opposite; bottom-row tiles are upright.
      const flipped = (row: string) =>
        page.locator(`.table-row.${row} .tile-inner`).evaluateAll((els) =>
          els.map((e) => {
            const m = new DOMMatrixReadOnly(getComputedStyle(e).transform);
            return m.a < -0.99 && m.d < -0.99;
          }),
        );
      expect(await flipped('top')).toEqual(top.map(() => true));
      expect(await flipped('bottom')).toEqual(bottom.map(() => false));
    });
  }
});

test('the game is saved: a reload resumes it, and leaving it keeps it', async ({ page }) => {
  await start(page, { players: 3 });
  await minus(page, 'Player 2').click();
  await plus(page, 'Player 3').click();
  await expect(life(page, 1)).toHaveText('39');

  await page.reload();
  await expect(page).toHaveURL(/#\/life\/game$/);
  await expect(life(page, 0)).toHaveText('40');
  await expect(life(page, 1)).toHaveText('39');
  await expect(life(page, 2)).toHaveText('41');

  await (await menu(page)).getByRole('link', { name: 'Leave game' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Life Counter' }).click();
  await expect(page).toHaveURL(/#\/life\/game$/);
  await expect(life(page, 1)).toHaveText('39');
});

test('blocked or full storage: the default game still works and says it will not be saved', async ({ page }) => {
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === 'swapsmith:life') throw new Error('full');
      return set.call(this, k, v);
    };
  });
  await start(page);
  await minus(page, 'Player 1').click();
  await expect(life(page, 0)).toHaveText('39');
  await expect(await menu(page).then((d) => d.getByText(/won't be saved/))).toBeVisible();

  // Saving the defaults fails the same way and says so, without throwing.
  await page.getByRole('dialog', { name: 'Game menu' }).getByRole('button', { name: 'Defaults' }).click();
  await page.getByRole('dialog', { name: 'Defaults' }).getByRole('button', { name: SAVE }).click();
  await expect(page.getByRole('dialog', { name: 'Defaults' }).getByText(/won't be saved/)).toBeVisible();
});

test('a damaged saved game is set aside and a default game opens', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('swapsmith:life')) localStorage.setItem('swapsmith:life', '{oops');
  });
  await page.goto('./#/life');
  await expect(page.locator('.tile')).toHaveCount(2);
  await expect(life(page, 0)).toHaveText('40');
  expect(await page.evaluate(() => localStorage.getItem('swapsmith:life:backup'))).toBe('{oops');
});

test('a game saved by a newer version is left untouched while a default game plays, until a new game starts', async ({ page }) => {
  const raw = JSON.stringify({ version: 2, game: { future: true } });
  await page.addInitScript((r) => {
    if (!localStorage.getItem('swapsmith:life')) localStorage.setItem('swapsmith:life', r);
  }, raw);
  await page.goto('./#/life');
  await expect(page.locator('.tile')).toHaveCount(2);
  await minus(page, 'Player 1').click();
  await expect(life(page, 0)).toHaveText('39');
  expect(await page.evaluate(() => localStorage.getItem('swapsmith:life'))).toBe(raw);
  await start(page, { players: 2 });
  await minus(page, 'Player 1').click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('swapsmith:life')!).version)).toBe(1);
});
