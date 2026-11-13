import { addCardToDeck, allFormats, buildQuery, COLORS, defaultFilters, canBeCommander, checkAdd, legalityLabel, loadPrefs, realOracleId, RARITIES, savePrefs, SORTS, type ColorMode, type Field, type Filters, type SortKey } from '../lib/browse';
import { cardImage } from '../lib/groups';
import { bestPrice, tcgplayerUrl } from '../lib/price';
import { THEMES } from '../lib/profile';
import { searchCards, type SearchPage } from '../scryfall/browse';
import { cardsByOracleId, cheapestPrintings, searchCommanders } from '../scryfall/cards';
import { ScryfallError } from '../scryfall/client';
import { POOL_ROLES } from '../scryfall/roles';
import { buildDeck, oracleIdOf } from '../scryfall/resolve';
import type { ScryCard } from '../scryfall/types';
import type { AppContext } from './app';
import { combobox } from './combobox';
import { segmented } from './controls';
import { h, usd } from './dom';

const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The role choices: the roles suggestions search for, plus token makers (there is no Tagger tag for them). */
const ROLES: Array<{ label: string; query: string }> = [
  ...POOL_ROLES.map((r) => ({ label: cap(r.label), query: r.query })),
  { label: 'Token maker', query: THEMES.find((t) => t.id === 'tokens')!.query },
];

/**
 * The Browse tab: search every card with a few filters and look through the results. The container stays
 * mounted while another tab shows, so the text, results and scroll survive a visit elsewhere.
 */
export function renderBrowse(view: HTMLElement, ctx: AppContext, storage: Storage | null): void {
  const loaded = loadPrefs(storage);
  let sort: SortKey = loaded.prefs.sort;
  let descending = loaded.prefs.descending;
  let layout: 'grid' | 'list' = loaded.prefs.view;
  let colorMode: ColorMode = 'within';
  /** The cards on screen, kept so a change of view can draw them again. */
  let cards: ScryCard[] = [];
  /** The search most recently started; replies from an older one are dropped. */
  let run = 0;
  /** The search being waited on (query and sort), so pressing Search twice asks once. */
  let waiting = '';
  /** The query last sent, which a change of sort repeats. */
  let lastQuery: string | null = null;
  /** The results on screen: what they were searched with, and where the next page starts. */
  let shown: { q: string; sort: SortKey; descending: boolean; page: number; hasMore: boolean; total: number } | null = null;
  /** A new search is waiting (the old results stay up meanwhile), or the next page is. */
  let searching = false;
  let loadingMore = false;

  const name = h('input', { id: 'browse-name', type: 'text', autocomplete: 'off', placeholder: 'e.g. sol ring' });
  const legal = h('input', { id: 'browse-legal', type: 'checkbox', checked: loaded.prefs.commanderLegal });
  const advanced = h('input', { id: 'browse-advanced', type: 'text', autocomplete: 'off', placeholder: 'e.g. t:elf mv<=2' });
  const advancedError = h('p', { id: 'browse-advanced-error', class: 'field-error', role: 'alert', hidden: true });
  const formError = h('p', { class: 'field-error', role: 'alert', hidden: true });
  const hint = h('p', { class: 'muted' }, 'Pick some filters and press Search. With no filters it lists the most popular Commander-legal cards.');
  const query = h('p', { class: 'muted small', hidden: true }, 'Searching: ', h('code', { 'data-testid': 'query' }));
  const count = h('p', { role: 'status', 'aria-live': 'polite' });
  const ignored = h('p', { class: 'banner', role: 'status', hidden: true });
  const results = h('ul', { class: layout === 'grid' ? 'card-grid' : 'card-list' });
  const more = h('button', { type: 'button', class: 'button', hidden: true }, 'Load more');
  const moreError = h('p', { class: 'field-error', role: 'alert', hidden: true });
  const sortSelect = h('select', { id: 'browse-sort' }, ...SORTS.map((s) => h('option', { value: s.id }, s.label)));
  sortSelect.value = sort;
  const direction = h('span');
  const layoutToggle = h('span');

  // The extra filters live in a collapsible section so the form stays short on a phone.
  const field = (id: string, label: string, input: HTMLElement) => h('div', { class: 'field' }, h('label', { for: id }, label), input);
  const text = (id: string, placeholder: string, mode?: string) => h('input', { id, type: 'text', autocomplete: 'off', placeholder, inputmode: mode });
  const setInput = text('browse-set', 'e.g. cmr');
  const typeInput = text('browse-type', 'e.g. legendary artifact');
  const tribeInput = text('browse-tribe', 'e.g. elf');
  const keywordInput = text('browse-keyword', 'e.g. flying');
  const roleSelect = h('select', { id: 'browse-role' }, h('option', { value: '' }, 'Any role'), ...ROLES.map((r) => h('option', { value: r.query }, r.label)));
  const mvMin = text('browse-mv-min', 'min', 'numeric');
  const mvMax = text('browse-mv-max', 'max', 'numeric');
  const priceMin = text('browse-price-min', 'min', 'decimal');
  const priceMax = text('browse-price-max', 'max', 'decimal');
  const colorBoxes = COLORS.map((c) => ({ id: c.id, box: h('input', { type: 'checkbox', id: `browse-color-${c.id}` }), label: c.label }));
  const rarityBoxes = RARITIES.map((r) => ({ id: r.id, box: h('input', { type: 'checkbox', id: `browse-rarity-${r.id}` }), label: r.label }));
  const colorModeBox = h('span');
  const filterError = h('p', { id: 'browse-filter-error', class: 'field-error', role: 'alert', hidden: true });
  const checks = (legend: string, items: Array<{ box: HTMLInputElement; label: string }>) =>
    h('fieldset', { class: 'checks' }, h('legend', {}, legend), ...items.map((i) => h('label', { class: 'own-label', for: i.box.id }, i.box, i.label)));
  const range = (label: string, lo: HTMLInputElement, hi: HTMLInputElement, loLabel: string, hiLabel: string) =>
    h(
      'div',
      { class: 'field' },
      h('span', { id: `${lo.id}-label`, class: 'label-text' }, label),
      h('div', { class: 'range', role: 'group', 'aria-labelledby': `${lo.id}-label` }, h('label', { class: 'sr-only', for: lo.id }, loLabel), lo, h('span', { 'aria-hidden': 'true' }, 'to'), h('label', { class: 'sr-only', for: hi.id }, hiLabel), hi),
    );
  const filters = h(
    'details',
    { class: 'more-filters' },
    h('summary', {}, 'More filters'),
    h(
      'div',
      { class: 'filter-grid' },
      field('browse-set', 'Set code', setInput),
      field('browse-type', 'Type', typeInput),
      field('browse-tribe', 'Tribe (creature type)', tribeInput),
      field('browse-keyword', 'Keyword', keywordInput),
      field('browse-role', 'Role', roleSelect),
      h('div', { class: 'field' }, checks('Color identity', colorBoxes), colorModeBox),
      range('Mana value', mvMin, mvMax, 'Mana value min', 'Mana value max'),
      checks('Rarity', rarityBoxes),
      h('div', { class: 'field' }, range('Price (USD)', priceMin, priceMax, 'Price min (USD)', 'Price max (USD)'), h('p', { class: 'muted small' }, 'Cards with no USD price are left out when you set a price.')),
    ),
    filterError,
  );

  // Each field's message is tied to its inputs, and the inputs at fault are marked invalid while it shows.
  advanced.setAttribute('aria-describedby', 'browse-advanced-error');
  for (const input of [setInput, typeInput, tribeInput, keywordInput, mvMin, mvMax, priceMin, priceMax]) input.setAttribute('aria-describedby', 'browse-filter-error');
  const atFault: Partial<Record<Field, HTMLElement[]>> = { advanced: [advanced], set: [setInput], type: [typeInput], tribe: [tribeInput], keyword: [keywordInput], mv: [mvMin, mvMax], price: [priceMin, priceMax], colors: colorBoxes.map((c) => c.box) };

  /** Shows one error where it belongs, opening the extra filters if that is where it is, and hides the rest. */
  const setError = (field: Field | null, message = '') => {
    for (const input of Object.values(atFault).flat()) input!.removeAttribute('aria-invalid');
    if (field) for (const input of atFault[field] ?? []) input.setAttribute('aria-invalid', 'true');
    const home = field === null ? null : field === 'advanced' ? advancedError : field === 'form' ? formError : filterError;
    for (const el of [advancedError, formError, filterError]) {
      el.hidden = el !== home;
      el.textContent = el === home ? message : '';
    }
    if (home === filterError) filters.open = true;
  };

  /** What the form holds now. */
  function readFilters(): Filters {
    return {
      ...defaultFilters(),
      name: name.value,
      commanderLegal: legal.checked,
      advanced: advanced.value,
      set: setInput.value,
      type: typeInput.value,
      tribe: tribeInput.value,
      keyword: keywordInput.value,
      role: roleSelect.value,
      colors: colorBoxes.filter((c) => c.box.checked).map((c) => c.id),
      colorMode,
      mvMin: mvMin.value,
      mvMax: mvMax.value,
      rarities: rarityBoxes.filter((r) => r.box.checked).map((r) => r.id),
      priceMin: priceMin.value,
      priceMax: priceMax.value,
    };
  }

  /** Remembers how results look and are ordered (not the filters), unless a newer version saved something there. */
  function persist() {
    if (!loaded.future) savePrefs(storage, { version: 1, view: layout, sort, descending, commanderLegal: legal.checked });
  }

  function drawColorMode() {
    colorModeBox.replaceChildren(
      segmented('Color match', [{ id: 'within', label: 'Within' }, { id: 'exactly', label: 'Exactly' }, { id: 'includes', label: 'Includes' }], colorMode, (id) => {
        colorMode = id;
        drawColorMode();
      }),
    );
  }

  function resetFilters() {
    for (const input of [name, advanced, setInput, typeInput, tribeInput, keywordInput, mvMin, mvMax, priceMin, priceMax]) input.value = '';
    roleSelect.value = '';
    for (const c of [...colorBoxes, ...rarityBoxes]) c.box.checked = false;
    colorMode = 'within';
    drawColorMode();
    setError(null);
  }

  function drawDirection() {
    direction.replaceChildren(
      segmented('Sort direction', [{ id: 'asc', label: 'Ascending' }, { id: 'desc', label: 'Descending' }], descending ? 'desc' : 'asc', (id) => {
        descending = id === 'desc';
        drawDirection();
        persist();
        rerun();
      }),
    );
  }

  const typeOf = (card: ScryCard) => card.type_line ?? card.card_faces?.[0]?.type_line ?? '';

  /** A card's name as a real button (keyboard and screen readers); the whole tile opens the detail too, for a mouse or a finger. */
  function opener(card: ScryCard): HTMLButtonElement {
    return h('button', { type: 'button', class: 'link-button card-open', 'aria-haspopup': 'dialog' }, card.name);
  }

  function tile(card: ScryCard): HTMLElement {
    const src = cardImage(card);
    const price = bestPrice(card);
    const open = opener(card);
    const li = h(
      'li',
      { class: 'card-tile', 'data-card': card.id },
      h(
        'div',
        { class: 'card-art' },
        src ? h('img', { src, alt: '', loading: 'lazy', width: 488, height: 680 }) : h('div', { class: 'card-missing', 'aria-hidden': 'true' }, card.name),
      ),
      h('div', { class: 'card-meta' }, h('span', { class: 'card-tile-name' }, open), h('span', { class: 'card-tile-price' }, price ? usd(price.price) : 'No price')),
    );
    li.addEventListener('click', () => openDetail(card, open));
    return li;
  }

  function row(card: ScryCard): HTMLElement {
    const price = bestPrice(card);
    const open = opener(card);
    const li = h(
      'li',
      { class: 'card-row', 'data-card': card.id },
      h('span', { class: 'card-row-name' }, open),
      h('span', { class: 'card-row-cost' }, card.mana_cost ?? ''),
      h('span', { class: 'card-row-type' }, typeOf(card)),
      h('span', { class: 'card-row-rarity' }, card.rarity ? cap(card.rarity) : ''),
      h('span', { class: 'card-row-price' }, price ? usd(price.price) : 'No price'),
    );
    li.addEventListener('click', () => openDetail(card, open));
    return li;
  }

  const render = (card: ScryCard) => (layout === 'grid' ? tile(card) : row(card));

  function drawResults() {
    results.className = layout === 'grid' ? 'card-grid' : 'card-list';
    results.replaceChildren(...cards.map(render));
  }

  function drawLayout() {
    layoutToggle.replaceChildren(
      segmented('View', [{ id: 'grid', label: 'Grid' }, { id: 'list', label: 'List' }], layout, (id) => {
        layout = id;
        drawLayout();
        drawResults();
        persist();
      }),
    );
  }

  // ---- Card detail ----------------------------------------------------------------------------
  /**
   * A modal with the card's picture, rules, legality and price, and actions. Each open builds its own
   * dialog, so a slow price reply for a card that was closed can only touch that card's own dialog.
   */
  function openDetail(card: ScryCard, from: HTMLElement) {
    const faces = card.card_faces && card.card_faces.length > 1 ? card.card_faces : null;
    const faceImages = faces?.map((f) => f.image_uris?.normal);
    const flips = !!faceImages && faceImages.every(Boolean);
    let face = 0;
    const dialog = h('dialog', { class: 'picker card-dialog', 'aria-labelledby': 'card-detail-h' });
    const picture = h('img', { class: 'card-detail-img', width: 488, height: 680 });
    const drawPicture = () => {
      const src = flips ? faceImages![face] : cardImage(card);
      if (src) picture.setAttribute('src', src);
      picture.setAttribute('alt', flips ? faces![face].name : card.name);
    };
    drawPicture();
    const flip = h('button', { type: 'button', class: 'button' }, 'Flip');
    flip.addEventListener('click', () => {
      face = (face + 1) % faces!.length;
      drawPicture();
    });

    const rules = (name: string | null, type: string | undefined, text: string | undefined) =>
      h('div', { class: 'rules' }, name ? h('h4', {}, name) : null, type ? h('p', { class: 'muted' }, type) : null, ...(text ?? '').split('\n').filter(Boolean).map((line) => h('p', {}, line)));

    const legal = legalityLabel(card.legalities?.commander);
    const formats = allFormats(card.legalities ?? {});

    // Price: the card as shown first, then the cheapest printing once it is known.
    const priceText = h('span', { class: 'detail-price' });
    const priceNote = h('p', { class: 'muted small' });
    const buy = h('span');
    const showPrice = (label: string, amount: number | null, link: string | null) => {
      priceText.textContent = amount == null ? 'No price' : `${label}${usd(amount)}`;
      buy.replaceChildren(...(link ? [h('a', { class: 'button', href: link, target: '_blank', rel: 'noopener noreferrer' }, 'Buy on TCGplayer ↗')] : []));
    };
    const own = bestPrice(card);
    showPrice('', own?.price ?? null, own ? tcgplayerUrl(card, own.finish) : null);
    const oid = realOracleId(card);
    if (oid) {
      priceNote.textContent = 'Checking other printings…';
      // The same one-request lookup a deck is priced with (ADR-006), so Browse and the deck agree on "cheapest".
      const unchecked = () => (priceNote.textContent = "Couldn't check other printings, so this is the price of the version shown.");
      cheapestPrintings(ctx.client, [oid]).then(({ cards, failed }) => {
        if (failed.size) return unchecked();
        const cheapest = cards.get(oid);
        const best = cheapest ? bestPrice(cheapest) : null;
        if (cheapest && best) {
          showPrice('Cheapest printing: ', best.price, tcgplayerUrl(cheapest, best.finish));
          priceNote.textContent = `${cheapest.set_name} #${cheapest.collector_number}${best.finish === 'nonfoil' ? '' : `, ${best.finish}`}`;
        } else priceNote.textContent = 'No printing has a price.';
      }, unchecked);
    } else priceNote.textContent = '';


    // ---- Add to deck… -------------------------------------------------------------------------
    // Browse is independent of the Decks tab: it asks which deck every time and preselects nothing.
    const NEW = '__new';
    const deckSelect = h('select', { id: 'add-deck-select' });
    const notes = h('div', { class: 'add-notes', role: 'status', 'aria-live': 'polite' });
    const done = h('div', { role: 'status', 'aria-live': 'polite' });
    const addBtn = h('button', { type: 'button', class: 'button primary', disabled: true }, 'Add');
    const createBtn = h('button', { type: 'button', class: 'button primary', disabled: true, hidden: true }, 'Create deck and add');
    const nameInput = h('input', { id: 'add-deck-name', type: 'text', autocomplete: 'off', placeholder: 'Optional' });
    const chosen = h('p', { class: 'muted small' }, 'Search for a legendary creature, or any card that can be your commander.');
    let commander: ScryCard | null = null;
    const pickCommander = (c: ScryCard) => {
      commander = c;
      search.input.value = c.name;
      chosen.replaceChildren(h('strong', {}, `Commander: ${c.name}`));
      sync();
    };
    const search = combobox<ScryCard>({
      id: 'add-commander-search',
      label: 'Commander',
      placeholder: 'Start typing a name, e.g. Edgar',
      search: (typed) => searchCommanders(ctx.client, typed),
      render: (c) => ({ label: c.name, detail: c.type_line ?? c.card_faces?.[0]?.type_line }),
      onPick: pickCommander,
    });
    const useThis = canBeCommander(card) ? h('button', { type: 'button', class: 'button' }, 'Use this card as commander') : null;
    useThis?.addEventListener('click', () => pickCommander(card));
    const newPanel = h('div', { class: 'stack', hidden: true }, h('div', { class: 'field' }, h('label', { for: 'add-deck-name' }, 'Deck name (optional)'), nameInput), search.root, chosen, useThis);

    /** What the colors check found for the chosen deck; null until it has settled (and again whenever the choice changes), which keeps Add off. */
    let check: ReturnType<typeof checkAdd> | null = null;
    let identity: string[] | null = null;
    /** This dialog already added the card to what is chosen: another press would add a second copy. */
    let added = false;
    /** Bumped on every change of choice; an answer for an older choice is dropped. */
    let choiceRun = 0;
    const identities = new Map<string, string[]>();
    const decksNewestFirst = () => [...ctx.store.decks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const chosenDeck = () => ctx.store.decks.find((d) => d.id === deckSelect.value);

    deckSelect.replaceChildren(
      h('option', { value: '' }, 'Choose a deck…'),
      ...decksNewestFirst().map((d) => h('option', { value: d.id }, `${d.name} (${d.commander.name})`)),
      h('option', { value: NEW }, 'New deck…'),
    );
    deckSelect.value = ctx.store.decks.length ? '' : NEW;

    function sync() {
      const making = deckSelect.value === NEW;
      newPanel.hidden = !making;
      addBtn.hidden = making;
      createBtn.hidden = !making;
      addBtn.disabled = added || !check || check.blocked != null || !chosenDeck();
      createBtn.disabled = added || !commander;
    }

    function showDone(deck: { id: string; name: string }) {
      done.replaceChildren(h('p', {}, `Added to ${deck.name}.`), h('a', { class: 'button', href: `#/deck/${deck.id}` }, 'Open deck'));
    }

    async function choose() {
      const mine = ++choiceRun;
      added = false;
      check = null;
      identity = null;
      notes.replaceChildren();
      done.replaceChildren();
      const deck = chosenDeck();
      sync();
      if (!deck) return;
      const known = identities.get(deck.commander.oracleId);
      if (known) identity = known;
      else {
        try {
          const found = (await cardsByOracleId(ctx.client, [deck.commander.oracleId])).get(deck.commander.oracleId);
          if (found) identities.set(deck.commander.oracleId, (identity = found.color_identity));
        } catch {
          // The colors can't be checked; adding still works, with a note.
        }
        if (mine !== choiceRun) return;
      }
      // The deck may have changed while we waited: look it up again.
      const fresh = chosenDeck();
      if (!fresh) return;
      check = checkAdd(fresh, card, identity);
      notes.replaceChildren(...[check.blocked, ...check.notes].filter((t): t is string => !!t).map((t) => h('p', {}, t)));
      sync();
    }
    deckSelect.addEventListener('change', () => void choose());

    addBtn.addEventListener('click', () => {
      const deck = chosenDeck();
      if (added || !check || check.blocked || !deck) return;
      ctx.saveDeck(addCardToDeck(deck, card));
      added = true;
      showDone(deck);
      sync();
    });

    createBtn.addEventListener('click', () => {
      if (added || !commander) return;
      let deck = buildDeck(nameInput.value, [], commander);
      let said: string[] = [];
      // The card is the commander (picked, or by the shortcut): it is not also a main-deck card.
      if (oracleIdOf(commander) !== oracleIdOf(card)) {
        const result = checkAdd(deck, card, commander.color_identity);
        if (result.blocked) return void notes.replaceChildren(h('p', {}, result.blocked));
        said = result.notes;
        deck = addCardToDeck(deck, card);
      }
      ctx.saveDeck(deck);
      added = true;
      notes.replaceChildren(...said.map((t) => h('p', {}, t)));
      showDone(deck);
      sync();
    });

    const addPanel = h(
      'div',
      { class: 'stack add-panel', hidden: true },
      h('div', { class: 'field' }, h('label', { for: 'add-deck-select' }, 'Deck'), deckSelect),
      newPanel,
      notes,
      h('div', { class: 'actions' }, addBtn, createBtn),
      done,
    );
    const addToggle = h('button', { type: 'button', class: 'button', 'aria-expanded': 'false' }, 'Add to deck…');
    addToggle.addEventListener('click', () => {
      const open = addPanel.hidden;
      addPanel.hidden = !open;
      addToggle.setAttribute('aria-expanded', String(open));
      if (open) {
        sync();
        deckSelect.focus();
      }
    });
    sync();

    const close = h('button', { type: 'button', class: 'button' }, 'Close');
    close.addEventListener('click', () => dialog.close());
    dialog.append(
      h('div', { class: 'picker-head' }, h('h3', { id: 'card-detail-h' }, card.name), close),
      h(
        'div',
        { class: 'card-detail' },
        h('div', { class: 'card-detail-art' }, picture, flips ? flip : null),
        h(
          'div',
          { class: 'stack' },
          card.mana_cost ? h('p', { class: 'mana-cost' }, card.mana_cost) : null,
          ...(faces ? faces.map((f) => rules(f.name, f.type_line, f.oracle_text)) : [rules(null, card.type_line, card.oracle_text)]),
          h('p', { class: `legality ${legal.tone}` }, legal.text),
          formats.length > 1 ? h('details', {}, h('summary', {}, 'All formats'), h('ul', { class: 'formats' }, ...formats.map((f) => h('li', {}, `${f.format}: ${f.status}`)))) : null,
          h('p', {}, priceText, ' ', buy),
          priceNote,
          h('div', { class: 'actions' }, addToggle),
          addPanel,
        ),
      ),
    );
    dialog.addEventListener('close', () => {
      dialog.remove();
      // The results may have been redrawn while the dialog was open, so find the opener again before giving focus back.
      const back = from.isConnected ? from : [...results.children].find((li) => (li as HTMLElement).dataset.card === card.id)?.querySelector('button');
      (back as HTMLElement | null | undefined)?.focus();
    });
    view.append(dialog);
    dialog.showModal();
  }

  const num = (n: number) => n.toLocaleString('en-US');

  /** The Load more button: there only while another page exists, and idle only when nothing is being fetched. */
  function syncMore() {
    more.hidden = !shown?.hasMore;
    more.disabled = searching || loadingMore;
  }

  function drawCount() {
    count.textContent = shown && results.children.length ? `Showing ${num(results.children.length)} of ${num(shown.total)} cards` : 'No cards match.';
  }

  function show(page: SearchPage, q: string, used: { sort: SortKey; descending: boolean }) {
    hint.hidden = true;
    cards = page.cards;
    drawResults();
    shown = { q, sort: used.sort, descending: used.descending, page: 1, hasMore: page.hasMore, total: page.total };
    drawCount();
    ignored.hidden = !page.warnings.length;
    ignored.replaceChildren(...(page.warnings.length ? ['Scryfall ignored part of this search, so these cards may not match it: ', page.warnings.join(' ')] : []));
  }

  async function load(q: string) {
    const key = `${q}\n${sort}\n${descending}`;
    if (key === waiting) return;
    const mine = ++run;
    waiting = key;
    // What this search asked with; a failure puts the earlier search's query back, so a sort change still sorts what is on screen.
    const used = { sort, descending };
    const previous = lastQuery;
    lastQuery = q;
    // This search owns the screen now: a page still on its way for the older one will be dropped.
    searching = true;
    loadingMore = false;
    moreError.hidden = true;
    syncMore();
    query.hidden = false;
    query.querySelector('code')!.textContent = q;
    count.textContent = 'Searching…';
    try {
      const page = await searchCards(ctx.client, q, sort, descending, 1);
      if (mine === run) show(page, q, used);
    } catch (e) {
      if (mine !== run) return;
      // The earlier results stay: one failed search shouldn't throw away what is on screen.
      lastQuery = previous;
      query.hidden = previous == null;
      query.querySelector('code')!.textContent = previous ?? '';
      const bad = e instanceof ScryfallError && e.status === 400;
      setError(bad && advanced.value.trim() ? 'advanced' : 'form', bad ? e.message : "Couldn't search Scryfall. Press Search to try again.");
      count.textContent = results.children.length ? `Showing ${num(results.children.length)} cards from the earlier search.` : '';
    } finally {
      if (mine === run) {
        waiting = '';
        searching = false;
        syncMore();
      }
    }
  }

  /** The next page of the results on screen. It belongs to the search that made them: a newer search drops its reply. */
  async function loadMore() {
    if (!shown || loadingMore || searching) return;
    const mine = run;
    const from = shown;
    loadingMore = true;
    moreError.hidden = true;
    syncMore();
    try {
      const page = await searchCards(ctx.client, from.q, from.sort, from.descending, from.page + 1);
      if (mine !== run) return;
      cards = [...cards, ...page.cards];
      results.append(...page.cards.map(render));
      from.page += 1;
      from.hasMore = page.hasMore;
      from.total = page.total;
      drawCount();
    } catch {
      if (mine !== run) return;
      moreError.textContent = "Couldn't load more cards. Press Load more to try again.";
      moreError.hidden = false;
    } finally {
      if (mine === run) {
        loadingMore = false;
        syncMore();
      }
    }
  }
  more.addEventListener('click', () => void loadMore());

  function rerun() {
    if (lastQuery) void load(lastQuery);
  }

  function submit() {
    const built = buildQuery(readFilters());
    if (!built.ok) {
      setError(built.field, built.error);
      return;
    }
    setError(null);
    void load(built.q);
  }

  sortSelect.addEventListener('change', () => {
    sort = sortSelect.value as SortKey;
    descending = SORTS.find((s) => s.id === sort)!.descending;
    drawDirection();
    persist();
    rerun();
  });
  legal.addEventListener('change', persist);
  // Colorless is its own choice: picking it clears the colors, and picking a color clears it.
  for (const c of colorBoxes) {
    c.box.addEventListener('change', () => {
      if (!c.box.checked) return;
      for (const other of colorBoxes) if (other !== c && (c.id === 'C' || other.id === 'C')) other.box.checked = false;
    });
  }
  drawDirection();
  drawLayout();
  drawColorMode();

  const form = h(
    'form',
    { class: 'browse-form stack', novalidate: true },
    h('div', { class: 'field' }, h('label', { for: 'browse-name' }, 'Card name'), name),
    h('label', { class: 'own-label' }, legal, 'Commander-legal'),
    filters,
    h(
      'div',
      { class: 'field' },
      h('label', { for: 'browse-advanced' }, 'Advanced search'),
      advanced,
      h('p', { class: 'muted small' }, 'Scryfall syntax, added to the filters above. ', h('a', { href: 'https://scryfall.com/docs/syntax', target: '_blank', rel: 'noopener' }, 'Syntax guide')),
      advancedError,
    ),
    formError,
    h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'button primary' }, 'Search'), h('button', { type: 'button', class: 'button', id: 'browse-reset' }, 'Reset filters')),
  );
  form.querySelector('#browse-reset')!.addEventListener('click', resetFilters);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });

  view.replaceChildren(
    h(
      'section',
      { class: 'stack', 'aria-labelledby': 'browse-h' },
      h('h2', { id: 'browse-h' }, 'Browse'),
      form,
      query,
      h('div', { class: 'actions' }, h('label', { for: 'browse-sort' }, 'Sort by'), sortSelect, direction, layoutToggle),
      hint,
      ignored,
      count,
      results,
      moreError,
      h('div', { class: 'actions' }, more),
    ),
  );
}
