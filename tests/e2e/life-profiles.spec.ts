import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockArt, type ArtMock } from './helpers';
import { artId, cachedRows, editPlayers, menu, start, tile, writeRows } from './life-helpers';

let art: ArtMock;
test.beforeEach(async ({ page }) => {
  art = await mockArt(page);
});

const DUNGEON = 'Dungeon Delver, art by Josh Freydkis';
const OTHER_DUNGEON = 'Dungeon Delver, art by Edgar Sánchez Hidalgo';
const nameBox = (page: Page, seat: number) => page.getByRole('textbox', { name: `Name for player ${seat}` });
const accentBox = (page: Page, seat: number) => page.getByRole('textbox', { name: `Custom accent for player ${seat}` });
const saveBtn = (page: Page, seat: number) => page.getByRole('button', { name: `Save as profile for player ${seat}`, exact: true });
const useBtn = (page: Page, seat: number) => page.getByRole('button', { name: `Use profile for player ${seat}`, exact: true });
const removeArt = (page: Page, seat: number) => page.getByRole('button', { name: `Remove art for player ${seat}`, exact: true });
const profileNote = (page: Page, seat: number) => page.locator('.player-row').nth(seat - 1).locator('.profile-note');
/** The Use profile dialog (it is named for the seat's current name, so it is found by class). */
const picker = (page: Page, _seat: number) => page.locator('dialog.profile-picker');

/** The profiles in the saved Life store. */
const stored = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('swapsmith:life') ?? '{}').profiles ?? []) as Array<{ id: string; name: string; art?: { id: string }; accent?: string }>);
const savedSeat = (page: Page, seat: number) =>
  page.evaluate((s) => JSON.parse(localStorage.getItem('swapsmith:life') ?? '{}').game?.players?.[s] as { name: string; art?: { id: string }; accent?: string }, seat);
const tileColor = (page: Page, seat: number) => tile(page, seat - 1).evaluate((e) => e.style.getPropertyValue('--tile'));

/** In the Edit players dialog, picks Dungeon Delver's art for a seat through the art picker. */
async function pickArt(page: Page, seat: number, card = DUNGEON) {
  await page.getByRole('button', { name: `Choose art for player ${seat}` }).click();
  const p = page.locator('dialog.art-picker'); // named for the seat's current name
  await p.getByRole('textbox', { name: 'Card name or artist' }).fill('delver');
  await p.getByRole('button', { name: 'Search', exact: true }).click();
  await p.getByRole('button', { name: card, exact: true }).click();
  await expect(tile(page, seat - 1)).toHaveAttribute('data-art', 'true');
}
/** Opens the Edit players dialog and gives seat 1 a name, an accent and art. Returns with the dialog open. */
async function dressSeatOne(page: Page, name = 'Edgar') {
  await editPlayers(page);
  await nameBox(page, 1).fill(name);
  await accentBox(page, 1).fill('#336699');
  await pickArt(page, 1);
}
/** Uses a profile on a seat from the open Edit players dialog. */
async function useProfile(page: Page, seat: number, name: string) {
  await useBtn(page, seat).click();
  await picker(page, seat).getByRole('button', { name, exact: true }).click();
  await expect(picker(page, seat)).toHaveCount(0);
}
/** Closes the Edit players dialog if it is open, then opens Game menu → Profiles. */
async function openProfiles(page: Page) {
  const edit = page.getByRole('dialog', { name: 'Edit players' });
  if (await edit.isVisible()) await edit.getByRole('button', { name: 'Close', exact: true }).click();
  const m = page.getByRole('dialog', { name: 'Game menu' });
  if (!(await m.isVisible())) await menu(page);
  await m.getByRole('button', { name: 'Profiles', exact: true }).click();
  const dlg = page.getByRole('dialog', { name: 'Profiles' });
  await expect(dlg).toBeVisible();
  return dlg;
}
const listed = (dlg: Locator) => dlg.locator('.profile-name');
const imageOf = (page: Page, seat: number) => tile(page, seat - 1).locator('.tile-art').evaluate((e) => getComputedStyle(e).backgroundImage);

test.describe('save and use', () => {
  test('a seat saved as a profile can be used on another seat: name, art and accent follow', async ({ page }) => {
    await start(page);
    await dressSeatOne(page);
    await saveBtn(page, 1).click();
    await expect(profileNote(page, 1)).toHaveText('Saved Edgar as a profile.');
    const [saved, ...rest] = await stored(page);
    expect(rest).toEqual([]);
    expect(saved.id).toMatch(/^p[0-9a-f]{8}$/);
    expect(saved.name).toBe('Edgar');
    expect(saved.accent).toBe('#336699');
    expect(saved.art?.id).toBe(await artId(page, 0));

    await useProfile(page, 2, 'Edgar');
    await expect(tile(page, 1).locator('.tile-name')).toHaveText('Edgar');
    await expect(tile(page, 1)).toHaveAttribute('data-art', 'true');
    expect(await tileColor(page, 2)).toBe('#336699');
    await expect(nameBox(page, 2)).toHaveValue('Edgar');
    await expect(accentBox(page, 2)).toHaveValue('#336699');
    await expect(page.locator('.player-row').nth(1).locator('.art-credit')).toContainText('Dungeon Delver');
    // Saved in the game, with the same image row (one image, two seats).
    const seat = await savedSeat(page, 1);
    expect(seat).toMatchObject({ name: 'Edgar', accent: '#336699' });
    expect(seat.art?.id).toBe(saved.art?.id);
    expect((await cachedRows(page)).filter((r) => r.id === saved.art?.id)).toHaveLength(1);
    await expect.poll(() => imageOf(page, 2)).toMatch(/^url\("blob:/);
    // A profile is copied: the profile record is untouched by the seat.
    expect(await stored(page)).toEqual([saved]);
  });

  test('using a profile with no art and no accent clears the seat\'s art and accent', async ({ page }) => {
    await start(page);
    await editPlayers(page);
    await nameBox(page, 1).fill('Plain');
    await saveBtn(page, 1).click();
    await expect(profileNote(page, 1)).toHaveText('Saved Plain as a profile.');
    expect(await stored(page)).toEqual([expect.objectContaining({ name: 'Plain' })]);
    expect((await stored(page))[0].art).toBeUndefined();
    await pickArt(page, 2);
    await accentBox(page, 2).fill('#336699');
    await useProfile(page, 2, 'Plain');
    await expect(tile(page, 1).locator('.tile-name')).toHaveText('Plain');
    await expect(tile(page, 1)).not.toHaveAttribute('data-art', 'true');
    await expect(accentBox(page, 2)).toHaveValue('');
    expect(await tileColor(page, 2)).not.toBe('#336699');
    expect((await savedSeat(page, 1)).accent).toBeUndefined();
    expect((await savedSeat(page, 1)).art).toBeUndefined();
    await expect(page.locator('.player-row').nth(1).locator('.art-credit')).toHaveText('No art');
  });

  test('a seat named "Player 1" (or any default name) is not saved: "Give this player a name first"', async ({ page }) => {
    await start(page);
    await editPlayers(page);
    await saveBtn(page, 1).click();
    await expect(profileNote(page, 1)).toHaveText('Give this player a name first');
    expect(await stored(page)).toEqual([]);
    // A typed default name counts as no name.
    await nameBox(page, 1).fill('Player 3');
    await saveBtn(page, 1).click();
    await expect(profileNote(page, 1)).toHaveText('Give this player a name first');
    expect(await stored(page)).toEqual([]);
    const dlg = await openProfiles(page);
    await expect(dlg).toContainText('No saved players yet');
  });

  test('the Use profile dialog with nothing saved says how to save one', async ({ page }) => {
    await start(page);
    await editPlayers(page);
    await useBtn(page, 1).click();
    await expect(picker(page, 1)).toContainText('No saved players yet. Use Save as profile on a seat.');
  });

  test('profiles survive a reload and a New game', async ({ page }) => {
    await start(page);
    await dressSeatOne(page);
    await saveBtn(page, 1).click();
    await expect(profileNote(page, 1)).toHaveText('Saved Edgar as a profile.');
    await page.reload();
    await expect(tile(page, 0)).toBeVisible();
    let dlg = await openProfiles(page);
    await expect(listed(dlg)).toHaveText(['Edgar']);
    await page.reload();
    await start(page, { players: 3 });
    dlg = await openProfiles(page);
    await expect(listed(dlg)).toHaveText(['Edgar']);
    const [p] = await stored(page);
    expect(p.art?.id).toBeTruthy();
    expect(p.accent).toBe('#336699');
  });

  test('a 13th save is refused with a visible message', async ({ page }) => {
    await start(page);
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('swapsmith:life')!);
      s.profiles = Array.from({ length: 12 }, (_, i) => ({ id: `seed${i}`, name: `Seed ${i}` }));
      localStorage.setItem('swapsmith:life', JSON.stringify(s));
    });
    await page.reload();
    await editPlayers(page);
    await nameBox(page, 1).fill('Thirteenth');
    await saveBtn(page, 1).click();
    await expect(profileNote(page, 1)).toHaveText('You already have 12 saved players. Delete one in the game menu under Profiles first.');
    const list = await stored(page);
    expect(list).toHaveLength(12);
    expect(list.map((p) => p.name)).not.toContain('Thirteenth');
  });

  test('a profile with art whose image is gone and the network down gives name and accent, an accent tile and a notice', async ({ page }) => {
    await start(page);
    await dressSeatOne(page);
    await saveBtn(page, 1).click();
    await expect(profileNote(page, 1)).toHaveText('Saved Edgar as a profile.');
    const id = (await artId(page, 0))!;
    await writeRows(page, [{ id, lastUsed: null }]);
    await page.route('https://cards.scryfall.io/**', (route) => route.abort());
    await useBtn(page, 2).click();
    await picker(page, 2).getByRole('button', { name: 'Edgar', exact: true }).click();
    await expect(profileNote(page, 2)).toContainText("Couldn't load the art for Edgar");
    await expect(tile(page, 1).locator('.tile-name')).toHaveText('Edgar');
    await expect(tile(page, 1)).not.toHaveAttribute('data-art', 'true');
    expect(await tileColor(page, 2)).toBe('#336699');
    expect(await tile(page, 1).evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(51, 102, 153)');
    const seat = await savedSeat(page, 1);
    expect(seat.name).toBe('Edgar');
    expect(seat.accent).toBe('#336699');
    expect(seat.art).toBeUndefined();
    // The profile keeps its art for a time the network is back.
    expect((await stored(page))[0].art?.id).toBe(id);
  });

  test('using a profile on a seat whose image went missing fetches it again and brings the art back', async ({ page }) => {
    await start(page);
    await dressSeatOne(page);
    await saveBtn(page, 1).click();
    await expect(profileNote(page, 1)).toHaveText('Saved Edgar as a profile.');
    const id = (await artId(page, 0))!;
    await writeRows(page, [{ id, lastUsed: null }]);
    await page.reload();
    await expect(tile(page, 0).locator('.tile-life')).toBeVisible();
    await page.waitForTimeout(300);
    await expect(tile(page, 0)).not.toHaveAttribute('data-art', 'true');
    await editPlayers(page);
    await useProfile(page, 1, 'Edgar');
    await expect(tile(page, 0)).toHaveAttribute('data-art', 'true');
    expect((await cachedRows(page)).map((r) => r.id)).toEqual([id]);
  });

  test('two seats on one profile share one image, and Remove art on one leaves the other\'s tile art', async ({ page }) => {
    await start(page, { players: 3 });
    await dressSeatOne(page);
    await saveBtn(page, 1).click();
    await expect(profileNote(page, 1)).toHaveText('Saved Edgar as a profile.');
    await removeArt(page, 1).click();
    await expect(tile(page, 0)).not.toHaveAttribute('data-art', 'true');
    await useProfile(page, 2, 'Edgar');
    await expect(tile(page, 1)).toHaveAttribute('data-art', 'true');
    await useProfile(page, 3, 'Edgar');
    await expect(tile(page, 2)).toHaveAttribute('data-art', 'true');
    await removeArt(page, 2).click();
    await expect(tile(page, 1)).not.toHaveAttribute('data-art', 'true');
    await page.waitForTimeout(300);
    await expect(tile(page, 2)).toHaveAttribute('data-art', 'true');
    const image = await imageOf(page, 3);
    const url = /url\("(.*)"\)/.exec(image)![1];
    expect(await page.evaluate(async (u) => (await fetch(u)).ok, url)).toBe(true);
    expect(await cachedRows(page)).toHaveLength(1);
    await page.reload();
    await expect(tile(page, 2)).toHaveAttribute('data-art', 'true');
  });

  test('the profile\'s image is kept out of eviction when other art is picked', async ({ page }) => {
    await start(page);
    await dressSeatOne(page);
    await saveBtn(page, 1).click();
    await expect(profileNote(page, 1)).toHaveText('Saved Edgar as a profile.');
    const kept = (await artId(page, 0))!;
    // No seat and no remembered setup uses it now: only the profile does.
    await removeArt(page, 1).click();
    await writeRows(page, [{ id: kept, lastUsed: 1 }, ...Array.from({ length: 23 }, (_, i) => ({ id: `filler-${i}`, lastUsed: 1000 + i }))]);
    expect((await cachedRows(page)).length).toBe(24);
    await pickArt(page, 2, OTHER_DUNGEON);
    const ids = (await cachedRows(page)).map((r) => r.id);
    expect(ids).toContain(kept);
    expect(ids).not.toContain('filler-0');
  });

  test('applying a profile that has to fetch its image does not evict another profile\'s image', async ({ page }) => {
    await start(page);
    await dressSeatOne(page, 'Edgar');
    await saveBtn(page, 1).click();
    await expect(profileNote(page, 1)).toHaveText('Saved Edgar as a profile.');
    const edgarArt = (await artId(page, 0))!;
    await nameBox(page, 1).fill('Breya');
    await pickArt(page, 1, OTHER_DUNGEON);
    await saveBtn(page, 1).click();
    await expect(profileNote(page, 1)).toHaveText('Saved Breya as a profile.');
    const breyaArt = (await artId(page, 0))!;
    expect(breyaArt).not.toBe(edgarArt);
    // Only Breya's profile holds her image now; it is the oldest row. Edgar's image is gone, so using him fetches it into a full cache.
    await removeArt(page, 1).click();
    await writeRows(page, [{ id: edgarArt, lastUsed: null }, { id: breyaArt, lastUsed: 1 }, ...Array.from({ length: 23 }, (_, i) => ({ id: `filler-${i}`, lastUsed: 1000 + i }))]);
    expect((await cachedRows(page)).length).toBe(24);
    await useProfile(page, 2, 'Edgar');
    await expect(tile(page, 1)).toHaveAttribute('data-art', 'true');
    const ids = (await cachedRows(page)).map((r) => r.id);
    expect(ids).toContain(edgarArt);
    expect(ids).toContain(breyaArt);
    expect(ids).not.toContain('filler-0');
  });

  test('a second art change while a profile is being applied is ignored, with a message', async ({ page }) => {
    await start(page);
    await dressSeatOne(page);
    await saveBtn(page, 1).click();
    await expect(profileNote(page, 1)).toHaveText('Saved Edgar as a profile.');
    const id = (await artId(page, 0))!;
    await removeArt(page, 1).click();
    await writeRows(page, [{ id, lastUsed: null }]);
    let release!: () => void;
    art.gate.image = new Promise<void>((r) => (release = r));
    await useBtn(page, 2).click();
    await picker(page, 2).getByRole('button', { name: 'Edgar', exact: true }).click();
    await page.getByRole('button', { name: 'Random art for player 1' }).evaluate((b: HTMLButtonElement) => b.click());
    await useBtn(page, 1).evaluate((b: HTMLButtonElement) => b.click());
    await picker(page, 1).getByRole('button', { name: 'Edgar', exact: true }).evaluate((b: HTMLButtonElement) => b.click());
    await expect(profileNote(page, 1)).toHaveText('Still saving the last art. Try again in a moment.');
    expect(art.randoms).toBe(0);
    release();
    await expect(tile(page, 1)).toHaveAttribute('data-art', 'true');
    await page.waitForTimeout(300);
    await expect(tile(page, 0)).not.toHaveAttribute('data-art', 'true');
  });

  test('a profile still being applied when a New game replaces the game is dropped', async ({ page }) => {
    await start(page);
    await dressSeatOne(page);
    await saveBtn(page, 1).click();
    await expect(profileNote(page, 1)).toHaveText('Saved Edgar as a profile.');
    const id = (await artId(page, 0))!;
    await writeRows(page, [{ id, lastUsed: null }]);
    let release!: () => void;
    art.gate.image = new Promise<void>((r) => (release = r));
    await useBtn(page, 2).click();
    await picker(page, 2).getByRole('button', { name: 'Edgar', exact: true }).click();
    await page.getByRole('dialog', { name: 'Edit players' }).getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('dialog', { name: 'Game menu' }).getByRole('button', { name: 'New game' }).click();
    await page.getByRole('dialog', { name: 'New game' }).getByRole('button', { name: 'Start' }).click();
    await page.getByRole('button', { name: 'Replace it' }).click();
    release();
    await page.waitForTimeout(500);
    await expect(tile(page, 1).locator('.tile-name')).not.toHaveText('Edgar');
    await expect(tile(page, 1)).not.toHaveAttribute('data-art', 'true');
    expect((await savedSeat(page, 1)).name).not.toBe('Edgar');
  });
});

test.describe('manage', () => {
  test('Rename in the menu changes the list but not a seat already playing', async ({ page }) => {
    await start(page);
    await dressSeatOne(page);
    await saveBtn(page, 1).click();
    await expect(profileNote(page, 1)).toHaveText('Saved Edgar as a profile.');
    await useProfile(page, 2, 'Edgar');
    const dlg = await openProfiles(page);
    await dlg.getByRole('button', { name: 'Rename Edgar', exact: true }).click();
    const field = dlg.getByRole('textbox', { name: 'New name for Edgar' });
    await expect(field).toBeFocused();
    await expect(field).toHaveValue('Edgar');
    await field.fill('Edgar B');
    await field.press('Enter');
    await expect(listed(dlg)).toHaveText(['Edgar B']);
    expect((await stored(page))[0].name).toBe('Edgar B');
    await dlg.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(tile(page, 1).locator('.tile-name')).toHaveText('Edgar');
    expect((await savedSeat(page, 1)).name).toBe('Edgar');
  });

  test('Rename: a blank name is refused and the old one stays; Cancel leaves it alone', async ({ page }) => {
    await start(page);
    await editPlayers(page);
    await nameBox(page, 1).fill('Edgar');
    await saveBtn(page, 1).click();
    await expect(profileNote(page, 1)).toHaveText('Saved Edgar as a profile.');
    const dlg = await openProfiles(page);
    await dlg.getByRole('button', { name: 'Rename Edgar', exact: true }).click();
    const field = dlg.getByRole('textbox', { name: 'New name for Edgar' });
    await field.fill('   ');
    await field.press('Enter');
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(dlg.getByRole('alert')).toHaveText('Enter a name');
    expect((await stored(page))[0].name).toBe('Edgar');
    await dlg.getByRole('button', { name: 'Cancel renaming Edgar', exact: true }).click();
    await expect(listed(dlg)).toHaveText(['Edgar']);
    await expect(dlg.getByRole('button', { name: 'Rename Edgar', exact: true })).toBeFocused();
  });

  test('Delete removes it at once, shows an undo toast, and Undo brings it back in place; the seat copied from it is intact', async ({ page }) => {
    await start(page);
    await dressSeatOne(page);
    await saveBtn(page, 1).click();
    await expect(profileNote(page, 1)).toHaveText('Saved Edgar as a profile.');
    await nameBox(page, 1).fill('Breya');
    await saveBtn(page, 1).click();
    await expect(profileNote(page, 1)).toHaveText('Saved Breya as a profile.');
    await useProfile(page, 2, 'Edgar');
    const dlg = await openProfiles(page);
    await expect(listed(dlg)).toHaveText(['Edgar', 'Breya']);
    await dlg.getByRole('button', { name: 'Delete Edgar', exact: true }).click();
    await expect(listed(dlg)).toHaveText(['Breya']);
    const toast = dlg.getByRole('status').filter({ hasText: 'Deleted Edgar' });
    await expect(toast).toBeVisible();
    expect((await stored(page)).map((p) => p.name)).toEqual(['Breya']);
    // The seat that was copied from it keeps its name, art and accent.
    const seat = await savedSeat(page, 1);
    expect(seat).toMatchObject({ name: 'Edgar', accent: '#336699' });
    expect(seat.art?.id).toBeTruthy();
    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(listed(dlg)).toHaveText(['Edgar', 'Breya']);
    expect((await stored(page)).map((p) => p.name)).toEqual(['Edgar', 'Breya']);
    await expect(toast).toHaveCount(0);
    await dlg.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(tile(page, 1).locator('.tile-name')).toHaveText('Edgar');
    await expect(tile(page, 1)).toHaveAttribute('data-art', 'true');
  });

  test('the undo toast goes away after 8 seconds and the deletion stays', async ({ page }) => {
    await start(page);
    await editPlayers(page);
    await nameBox(page, 1).fill('Edgar');
    await saveBtn(page, 1).click();
    await expect(profileNote(page, 1)).toHaveText('Saved Edgar as a profile.');
    const dlg = await openProfiles(page);
    await page.clock.install();
    await dlg.getByRole('button', { name: 'Delete Edgar', exact: true }).click();
    await expect(dlg.getByRole('button', { name: 'Undo' })).toBeVisible();
    await page.clock.fastForward(7000);
    await expect(dlg.getByRole('button', { name: 'Undo' })).toBeVisible();
    await page.clock.fastForward(2000);
    await expect(dlg.getByRole('button', { name: 'Undo' })).toHaveCount(0);
    expect(await stored(page)).toEqual([]);
    await expect(dlg).toContainText('No saved players yet');
  });

  test('the image of a deleted profile stays in the cache', async ({ page }) => {
    await start(page);
    await dressSeatOne(page);
    await saveBtn(page, 1).click();
    await expect(profileNote(page, 1)).toHaveText('Saved Edgar as a profile.');
    const id = (await artId(page, 0))!;
    const dlg = await openProfiles(page);
    await dlg.getByRole('button', { name: 'Delete Edgar', exact: true }).click();
    await expect(dlg).toContainText('No saved players yet');
    expect((await cachedRows(page)).map((r) => r.id)).toContain(id);
  });
});

test.describe('safety and layout', () => {
  test('a name that looks like HTML is shown as text in the Use profile list and the Profiles list', async ({ page }) => {
    const dialogs: string[] = [];
    const errors: string[] = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    page.on('pageerror', (e) => errors.push(e.message));
    const evil = '<img src=x onerror=a()>';
    await start(page);
    await editPlayers(page);
    await nameBox(page, 1).fill(evil);
    await saveBtn(page, 1).click();
    await expect(profileNote(page, 1)).toContainText(evil);
    await useBtn(page, 2).click();
    const pick = picker(page, 2);
    await expect(pick.getByRole('button', { name: evil, exact: true })).toBeVisible();
    await expect(pick.getByText(evil, { exact: true })).toBeVisible();
    await expect(pick.locator('img')).toHaveCount(0);
    await pick.getByRole('button', { name: 'Close', exact: true }).click();
    const dlg = await openProfiles(page);
    await expect(listed(dlg)).toHaveText([evil]);
    await expect(dlg.locator('img')).toHaveCount(0);
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(dialogs).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('both Profile dialogs have 44 px rows, and focus returns to the control that opened them', async ({ page }) => {
    await start(page);
    await editPlayers(page);
    await nameBox(page, 1).fill('Edgar');
    await saveBtn(page, 1).click();
    await expect(profileNote(page, 1)).toHaveText('Saved Edgar as a profile.');

    await useBtn(page, 2).click();
    const pick = picker(page, 2);
    await expect(pick).toBeVisible();
    const rowBoxes = await pick.locator('.profile-pick').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    expect(rowBoxes.length).toBe(1);
    for (const hgt of rowBoxes) expect(hgt).toBeGreaterThanOrEqual(44);
    await expect(pick.locator('.profile-pick .swatch-chip')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(pick).toHaveCount(0);
    await expect(useBtn(page, 2)).toBeFocused();

    const dlg = await openProfiles(page);
    const heights = await dlg.locator('.profile-row button, .profile-row input').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    expect(heights.length).toBeGreaterThanOrEqual(2);
    for (const hgt of heights) expect(hgt).toBeGreaterThanOrEqual(44);
    // Nothing runs off the side of a phone-width dialog.
    const over = await dlg.evaluate((d) => d.scrollWidth - d.clientWidth);
    expect(over).toBeLessThanOrEqual(0);
    await dlg.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dlg).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Game menu' }).getByRole('button', { name: 'Profiles', exact: true })).toBeFocused();
  });

  test('the Profiles dialog has its sticky Close in view with a full pod of twelve', async ({ page }) => {
    await start(page);
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('swapsmith:life')!);
      s.profiles = Array.from({ length: 12 }, (_, i) => ({ id: `seed${i}`, name: `Seed player ${i}`, accent: '#336699' }));
      localStorage.setItem('swapsmith:life', JSON.stringify(s));
    });
    await page.reload();
    const dlg = await openProfiles(page);
    await expect(listed(dlg)).toHaveCount(12);
    const close = dlg.getByRole('button', { name: 'Close', exact: true });
    await expect(close).toBeInViewport();
    const vh = page.viewportSize()!.height;
    const box = (await close.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(vh);
    await dlg.evaluate((d) => (d.scrollTop = d.scrollHeight));
    await expect(close).toBeInViewport();
  });
});
