import { expect, test, type Page, type Route } from '@playwright/test';
import { browseSearches, flows, mockScryfall } from './helpers';

const CRYPT = 'legal:commander name:"crypt"';
type Face = { name: string; oracle_text?: string; type_line?: string; image_uris?: { normal?: string } };
type Card = {
  id: string; oracle_id?: string; name: string; mana_cost?: string; type_line?: string; oracle_text?: string; rarity?: string;
  prices: Record<string, string | null>; tcgplayer_id?: number; tcgplayer_etched_id?: number; set_name: string;
  legalities: Record<string, string>; card_faces?: Face[]; image_uris?: { normal?: string };
};
const keyOf = (q: string) => `GET /cards/search?${new URLSearchParams({ q, order: 'edhrec', dir: 'asc', unique: 'cards', page: '1' })}`;
const results = (q: string) => (browseSearches[keyOf(q)].body as { data: Card[] }).data;
const named = (q: string, name: string) => results(q).find((c) => c.name === name)!;
const oracleOf = (c: Card) => c.oracle_id ?? (c.card_faces![0] as Face & { oracle_id: string }).oracle_id;
/** The recorded cheapest printing of a card (a list of one), and the cheapest price among its finishes. */
const printingsOf = (c: Card) => (browseSearches[Object.keys(browseSearches).find((k) => k.includes(`oracleid%3A${oracleOf(c)}`))!].body as { data: Card[] }).data;
function cheapest(prints: Card[]) {
  let best: { price: number; card: Card; etched: boolean } | null = null;
  for (const card of prints) {
    for (const [field, etched] of [['usd', false], ['usd_foil', false], ['usd_etched', true]] as const) {
      const price = Number(card.prices[field]);
      if (Number.isFinite(price) && price > 0 && (!best || price < best.price)) best = { price, card, etched };
    }
  }
  return best!;
}
const money = (n: number) => `$${n.toFixed(2)}`;

let misses: string[];
test.beforeEach(async ({ page }) => {
  misses = await mockScryfall(page, { ...flows, ...browseSearches });
});

const find = async (page: Page, name: string, q = 'crypt') => {
  await page.goto('./#/browse');
  await page.getByLabel('Card name').fill(q);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.locator('.card-tile').first()).toBeVisible();
  return page.getByRole('button', { name, exact: true });
};
const open = async (page: Page, name: string, q = 'crypt') => {
  const opener = await find(page, name, q);
  await opener.click();
  const dialog = page.getByRole('dialog', { name });
  await expect(dialog).toBeVisible();
  return { dialog, opener };
};

/** Answers the first Crypt search with the recorded reply, after `change` edited a copy of its first card. */
async function editFirstCrypt(page: Page, change: (card: Card) => void) {
  await page.route((u) => u.hostname === 'api.scryfall.com' && u.searchParams.get('q') === CRYPT && u.searchParams.get('order') === 'edhrec' && u.searchParams.get('dir') === 'asc', (route: Route) => {
    const body = structuredClone(browseSearches[keyOf(CRYPT)].body) as { data: Card[] };
    change(body.data[0]);
    return route.fulfill({ status: 200, json: body });
  });
}

test('opens a card with its rules, legality and the cheapest printing\'s price and TCGplayer link', async ({ page }) => {
  const ghast = named(CRYPT, 'Crypt Ghast');
  const { dialog } = await open(page, 'Crypt Ghast');
  await expect(dialog.getByText(ghast.mana_cost!)).toBeVisible();
  await expect(dialog.getByText(ghast.type_line!)).toBeVisible();
  await expect(dialog).toContainText(ghast.oracle_text!.split('\n')[0]);
  await expect(dialog).toContainText(ghast.oracle_text!.split('\n')[1]);
  await expect(dialog.getByText('Legal in Commander')).toBeVisible();
  await expect(dialog.getByRole('img', { name: 'Crypt Ghast' })).toBeVisible();

  const best = cheapest(printingsOf(ghast));
  await expect(dialog.getByText(`Cheapest printing: ${money(best.price)}`)).toBeVisible();
  const id = best.etched && best.card.tcgplayer_etched_id ? best.card.tcgplayer_etched_id : best.card.tcgplayer_id;
  const buy = dialog.getByRole('link', { name: /Buy on TCGplayer/ });
  await expect(buy).toHaveAttribute('href', `https://www.tcgplayer.com/product/${id}`);
  await expect(buy).toHaveAttribute('target', '_blank');
  await expect(buy).toHaveAttribute('rel', /noopener/);

  await dialog.getByText('All formats').click();
  await expect(dialog.getByRole('listitem').filter({ hasText: 'Commander' }).first()).toContainText('Legal');
  await page.screenshot({ path: test.info().outputPath(`detail-${test.info().project.name}.png`) });
  expect(misses.filter((m) => !m.includes('oracleid'))).toEqual([]);
});

test('closes with Escape or Close and gives focus back to the card', async ({ page }) => {
  const { dialog, opener } = await open(page, 'Crypt Ghast');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await opener.click();
  await page.getByRole('dialog', { name: 'Crypt Ghast' }).getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('a card opens from the list view too', async ({ page }) => {
  await find(page, 'Crypt Ghast');
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await page.getByRole('button', { name: 'Crypt Ghast', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Crypt Ghast' })).toBeVisible();
});

test('a double-faced card shows both faces and flips its picture', async ({ page }) => {
  const mdfc = named(CRYPT, "Agadeem's Awakening // Agadeem, the Undercrypt");
  const [front, back] = mdfc.card_faces!;
  const { dialog } = await open(page, mdfc.name);
  const picture = dialog.locator('img').first();
  await expect(picture).toHaveAttribute('src', front.image_uris!.normal!);
  await expect(dialog).toContainText(front.oracle_text!.split('\n')[0]);
  await expect(dialog).toContainText(back.oracle_text!.split('\n')[0]);
  await expect(dialog.getByRole('heading', { name: back.name, exact: true })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: front.name, exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Flip' }).click();
  await expect(picture).toHaveAttribute('src', back.image_uris!.normal!);
  await dialog.getByRole('button', { name: 'Flip' }).click();
  await expect(picture).toHaveAttribute('src', front.image_uris!.normal!);
});

test('a single-faced card has no Flip button', async ({ page }) => {
  const { dialog } = await open(page, 'Crypt Ghast');
  await expect(dialog.getByRole('button', { name: 'Flip' })).toHaveCount(0);
});

test.describe('what the detail says when data is odd', () => {
  test('printings that cannot be loaded leave the price of the card as shown, with a note', async ({ page }) => {
    await page.route((u) => u.hostname === 'api.scryfall.com' && (u.searchParams.get('q') ?? '').startsWith('(oracleid:'), (route) => route.fulfill({ status: 503, json: { object: 'error', details: 'Service Unavailable' } }));
    const ghast = named(CRYPT, 'Crypt Ghast');
    const { dialog } = await open(page, 'Crypt Ghast');
    await expect(dialog.getByText(/Couldn't check other printings/)).toBeVisible();
    // The result's own price is its cheapest finish (the foil is cheaper than the nonfoil here).
    await expect(dialog.getByText(money(cheapest([ghast]).price), { exact: true })).toBeVisible();
    await expect(dialog.getByRole('link', { name: /Buy on TCGplayer/ })).toBeVisible();
  });

  test('a card with no price says so and has no Buy link', async ({ page }) => {
    await editFirstCrypt(page, (c) => {
      c.prices = { usd: null, usd_foil: null, usd_etched: null };
    });
    const { dialog } = await open(page, 'Blood Crypt');
    await expect(dialog.getByText('No price')).toBeVisible();
    await expect(dialog.getByRole('link', { name: /Buy on TCGplayer/ })).toHaveCount(0);
  });

  test('legality that is banned, missing or odd is said in words', async ({ page }) => {
    await editFirstCrypt(page, (c) => {
      c.legalities = { commander: 'banned' };
    });
    const { dialog } = await open(page, 'Blood Crypt');
    await expect(dialog.getByText('Banned in Commander')).toBeVisible();
  });

  test('missing legality reads as unknown', async ({ page }) => {
    await editFirstCrypt(page, (c) => {
      c.legalities = {};
    });
    const { dialog } = await open(page, 'Blood Crypt');
    await expect(dialog.getByText('Commander legality unknown')).toBeVisible();
    await expect(dialog.getByText('All formats')).toHaveCount(0);
  });

  test('a late printings reply for the card that was closed does not change the next card', async ({ page }) => {
    const ghast = named(CRYPT, 'Crypt Ghast');
    const mdfc = named(CRYPT, "Agadeem's Awakening // Agadeem, the Undercrypt");
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    await page.route((u) => u.hostname === 'api.scryfall.com' && (u.searchParams.get('q') ?? '').includes(`oracleid:${ghast.oracle_id}`), async (route) => {
      await held;
      await route.fallback();
    });
    const { dialog } = await open(page, 'Crypt Ghast');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: mdfc.name, exact: true }).click();
    const second = page.getByRole('dialog', { name: mdfc.name });
    const want = money(cheapest(printingsOf(mdfc)).price);
    await expect(second.getByText(`Cheapest printing: ${want}`)).toBeVisible();
    release();
    await page.waitForTimeout(600);
    await expect(second.getByText(`Cheapest printing: ${want}`)).toBeVisible();
    await expect(second.getByText(money(cheapest(printingsOf(ghast)).price))).toHaveCount(0);
  });
});

test('an open detail is closed when another tab shows, and the page stays usable', async ({ page }) => {
  await open(page, 'Crypt Ghast');
  await page.evaluate(() => {
    location.hash = '#/';
  });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Your decks' })).toBeVisible();
  await page.getByRole('link', { name: 'New deck' }).click();
  await expect(page.getByRole('heading', { name: 'New deck' })).toBeVisible();
});
