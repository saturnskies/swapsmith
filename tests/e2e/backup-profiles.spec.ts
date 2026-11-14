import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mockArt } from './helpers';
import { editPlayers, start } from './life-helpers';

test.beforeEach(async ({ page }) => {
  await mockArt(page);
});

const nameBox = (page: Page, seat: number) => page.getByRole('textbox', { name: `Name for player ${seat}` });
const BACKUP = (extra: object) => JSON.stringify({ app: 'swapsmith', backup: 1, exportedAt: '2026-11-14T00:00:00.000Z', store: { version: 1, decks: [], owned: [], unownedBasics: [], prefs: { view: 'list' } }, ...extra });

/** Names seat 1, then saves it as a profile from the Edit players dialog, and closes the dialog. */
async function saveProfile(page: Page, name: string) {
  await editPlayers(page);
  await nameBox(page, 1).fill(name);
  await page.getByRole('button', { name: 'Save as profile for player 1', exact: true }).click();
  await expect(page.locator('.player-row').first().locator('.profile-note')).toHaveText(`Saved ${name} as a profile.`);
  await page.getByRole('dialog', { name: 'Edit players' }).getByRole('button', { name: 'Close', exact: true }).click();
  // The Game menu it was opened from is still open underneath.
  await page.getByRole('dialog', { name: 'Game menu' }).getByRole('button', { name: 'Close', exact: true }).click();
}
/** The profile names offered by Use profile for seat 2 in the Life Counter. */
async function savedNames(page: Page) {
  await page.goto('./#/life');
  await editPlayers(page);
  await page.getByRole('button', { name: 'Use profile for player 2', exact: true }).click();
  const dlg = page.locator('dialog.profile-picker');
  await expect(dlg).toBeVisible();
  const names = await dlg.locator('button.profile-pick').evaluateAll((els) => els.map((e) => e.querySelector('.profile-name')?.textContent ?? ''));
  await page.keyboard.press('Escape');
  return names;
}
async function backUp(page: Page, testInfo: TestInfo) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Back up my decks' }).click();
  const path = testInfo.outputPath('backup.json');
  await (await download).saveAs(path);
  return path;
}
const storedProfiles = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('swapsmith:life') ?? '{}').profiles ?? []);
const seedProfiles = (page: Page, n: number) =>
  page.evaluate((count) => {
    const s = JSON.parse(localStorage.getItem('swapsmith:life')!);
    s.profiles = Array.from({ length: count }, (_, i) => ({ id: `seed${i}`, name: `Seed ${i}` }));
    localStorage.setItem('swapsmith:life', JSON.stringify(s));
  }, n);
/** Goes to the home screen (without a reload, so an open Life Counter stays as it is) and picks the file to restore. */
const restore = async (page: Page, path: string) => {
  await page.goto('./#/');
  await page.getByLabel('Backup file').setInputFiles(path);
};
const edgarDeck = JSON.parse(readFileSync(new URL('../fixtures/edgar-deck.json', import.meta.url), 'utf8'));

test('Back up carries the saved profiles and leaves the store as it was', async ({ page }, testInfo) => {
  await start(page);
  await saveProfile(page, 'Edgar');
  await saveProfile(page, 'Breya');
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Backup and restore' })).toBeVisible();
  const path = await backUp(page, testInfo);
  const file = JSON.parse(readFileSync(path, 'utf8'));
  expect(file.profiles.map((p: { name: string }) => p.name)).toEqual(['Edgar', 'Breya']);
  expect(file.profiles[0].id).toMatch(/^p[0-9a-f]{8}$/);
  expect(file).toMatchObject({ app: 'swapsmith', backup: 1 });
  expect(Object.keys(file.store).sort()).toEqual(['decks', 'owned', 'prefs', 'unownedBasics', 'version']);
  await expect(page.getByText('Backup file made with 0 decks and 2 player profiles.')).toBeVisible();
});

test('a backup with no profiles to carry has no profiles field and says nothing about them', async ({ page }, testInfo) => {
  await page.goto('./');
  const path = await backUp(page, testInfo);
  expect(JSON.parse(readFileSync(path, 'utf8'))).not.toHaveProperty('profiles');
  await expect(page.getByText(/^Backup file made with 0 decks\. Keep it somewhere safe/)).toBeVisible();
});

test('lose everything, Restore, and the profiles are back in Use profile', async ({ page }, testInfo) => {
  await start(page);
  await saveProfile(page, 'Edgar');
  await saveProfile(page, 'Breya');
  await page.goto('./');
  const path = await backUp(page, testInfo);

  await page.evaluate(() => localStorage.clear());
  await page.goto('./');
  await page.reload();
  await expect(page.getByText('No decks yet')).toBeVisible();

  await page.getByLabel('Backup file').setInputFiles(path);
  await expect(page.getByText('Restored: 0 decks added, 0 updated, 2 player profiles added. Nothing was deleted.')).toBeVisible();
  expect(await savedNames(page)).toEqual(['Edgar', 'Breya']);

  // Restoring the same file again adds nothing and does not duplicate.
  await restore(page, path);
  await expect(page.getByText('Restored: 0 decks added, 0 updated, 0 player profiles added. Nothing was deleted.')).toBeVisible();
  expect(await storedProfiles(page)).toHaveLength(2);
});

test('restoring an old file with no profiles field leaves the saved profiles alone', async ({ page }, testInfo) => {
  await start(page);
  await saveProfile(page, 'Edgar');
  const old = testInfo.outputPath('old.json');
  writeFileSync(old, BACKUP({}));
  await restore(page, old);
  await expect(page.getByText('Restored: 0 decks added, 0 updated. Nothing was deleted.')).toBeVisible();
  await expect(page.getByText(/player profile/)).toHaveCount(0);
  expect((await storedProfiles(page)).map((p: { name: string }) => p.name)).toEqual(['Edgar']);
});

test('restoring into a full pod of 12 skips the extras and says how many', async ({ page }, testInfo) => {
  await start(page);
  await seedProfiles(page, 12);
  const file = testInfo.outputPath('two.json');
  writeFileSync(file, BACKUP({ profiles: [{ id: 'pa0000aa', name: 'Edgar' }, { id: 'pb0000bb', name: 'Breya' }] }));
  await restore(page, file);
  await expect(page.getByText('Restored: 0 decks added, 0 updated, 0 player profiles added (2 skipped, pod is full). Nothing was deleted.')).toBeVisible();
  expect(await storedProfiles(page)).toHaveLength(12);
});

test('a file whose profiles are junk still restores the decks and says nothing about profiles', async ({ page }, testInfo) => {
  await start(page);
  await saveProfile(page, 'Edgar');
  const deck = { ...edgarDeck, id: 'junk-deck', name: 'Junk test' };
  for (const junk of ['nope', 42, [{ id: 3 }, null, 'x'], { id: 'p1', name: 'Obj' }]) {
    // A fresh page each time, with the deck gone, so the decks are restored every round.
    await page.goto('./#/');
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('swapsmith:v1') ?? '{"version":1,"decks":[],"owned":[],"unownedBasics":[],"prefs":{}}');
      s.decks = [];
      localStorage.setItem('swapsmith:v1', JSON.stringify(s));
    });
    await page.reload();
    const file = testInfo.outputPath('junk.json');
    writeFileSync(file, JSON.stringify({ ...JSON.parse(BACKUP({ profiles: junk })), store: { version: 1, decks: [deck], owned: [], unownedBasics: [], prefs: { view: 'list' } } }));
    await restore(page, file);
    await expect(page.getByText('Restored: 1 deck added, 0 updated. Nothing was deleted.')).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'Junk test' })).toHaveCount(1);
    await expect(page.getByText(/player profile/)).toHaveCount(0);
  }
  expect((await storedProfiles(page)).map((p: { name: string }) => p.name)).toEqual(['Edgar']);
});

test('restoring a file that is not a backup still says so and leaves profiles alone', async ({ page }, testInfo) => {
  await start(page);
  await saveProfile(page, 'Edgar');
  const bad = testInfo.outputPath('bad.json');
  writeFileSync(bad, '{"hello": "world", "profiles": [{"id":"pzzzzzzzz","name":"Sneaky"}]}');
  await restore(page, bad);
  await expect(page.getByRole('alert').filter({ hasText: "isn't a Swapsmith backup" })).toBeVisible();
  expect((await storedProfiles(page)).map((p: { name: string }) => p.name)).toEqual(['Edgar']);
});

test('profiles restored while the Life Counter is open in the same session show without a reload', async ({ page }, testInfo) => {
  await start(page);
  const file = testInfo.outputPath('one.json');
  writeFileSync(file, BACKUP({ profiles: [{ id: 'pa0000aa', name: 'Kess' }] }));
  await restore(page, file);
  await expect(page.getByText('Restored: 0 decks added, 0 updated, 1 player profile added. Nothing was deleted.')).toBeVisible();
  expect(await savedNames(page)).toEqual(['Kess']);
});
