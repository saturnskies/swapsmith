import { edhrecCandidates, type EdhrecResult, type KnownCards } from '../edhrec/candidates';
import { pageUrl } from '../edhrec/page';
import { BRACKETS, commanderSlug, estimateBracket, type PageFilter } from '../lib/edhrec';
import { deckTypeCounts, gapCategories, typeGaps } from '../lib/gaps';
import { cardImage } from '../lib/groups';
import { deckProfile, type DeckProfile } from '../lib/profile';
import { tcgplayerUrl } from '../lib/price';
import { byCategory, roleLookupNames, scoreEdhrec, scoreSuggestions, tierOf, TIERS, type PoolEntry, type Suggestion, type Tier } from '../lib/suggest';
import type { Collection } from '../lib/owned';
import { similarTo, type SwapOption, type Tapped } from '../lib/similar';
import { cheaperReplacements, edhrecKeepScores, swapPairs } from '../lib/swaps';
import { frontFace, looseName } from '../scryfall/cards';
import type { PricedCard } from '../scryfall/resolve';
import { gameChangerCount } from '../scryfall/names';
import { deckRoles } from '../scryfall/roles';
import { candidatePool, deckCardFacts, rulesText } from '../scryfall/suggest';
import type { ScryCard } from '../scryfall/types';
import type { AppContext } from './app';
import { segmented } from './controls';
import { h, usd } from './dom';

/** Cards shown per category before Show more, and how many more each click adds. */
const CATEGORY_STEP = 5;
/** Themes offered in the Theme menu: EDHREC lists over a hundred for popular commanders. */
const THEME_MENU = 20;
const ALL_DECKS: PageFilter = { bracket: null, theme: null, budget: false };

type EdhState = { status: 'loading' } | EdhrecResult | { status: 'lookup-failed' };

const COLOR_NAMES: Record<string, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };

type View = 'upgrades' | 'swaps' | 'cheaper';
const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'upgrades', label: 'Upgrades' },
  { id: 'swaps', label: 'Swaps' },
  { id: 'cheaper', label: 'Cheaper' },
];

export interface PanelActions {
  add(card: ScryCard): Promise<void>;
  /** Replaces the deck card with this Oracle ID by the suggested card. */
  swap(cutOracleId: string, add: ScryCard): Promise<void>;
  undo(): void;
  /** A short label for the last swap, or null when there is nothing to undo. */
  lastSwap(): string | null;
  /** The cards owned for this deck only: suggestions never look at what you own for another deck. */
  collection(): Collection;
  /** Where the latest search is, for the badge on the Suggestions tab. Only the current run reports. */
  onSearch(state: 'searching' | 'ready' | 'failed'): void;
  /** The bracket saved with the deck for EDHREC suggestions (0 = all decks), if any. */
  bracket(): number | undefined;
  /** Saves a bracket picked in the panel with the deck (0 = all decks). */
  setBracket(bracket: number): void;
}

/**
 * What the card dialog can show for a tapped card: nothing yet, a load in progress, a failed load (Try again can help),
 * a card there is nothing to compare (no Scryfall data, or no longer in the deck; Try again cannot help), or its options.
 */
export type SwapOptionsState =
  | { status: 'idle' | 'loading' | 'failed' | 'unavailable' }
  | {
      status: 'ready';
      source: 'edhrec' | 'rules';
      options: SwapOption[];
      /** False when EDHREC's page doesn't list the tapped card (it scores 0). Always true for the rules fallback, which has no page to be missing from. */
      listed: boolean;
      /** "In 45% of Edgar Markov decks", when the page lists the tapped card. */
      popularity?: string;
      /** True while roles are still loading (the deck's, or EDHREC's cards'): matching by job is not final, so an empty list isn't an answer yet. */
      checking: boolean;
    };

export type SwapPanel = ReturnType<typeof suggestionsPanel>;

/**
 * Suggestions beside the deck: upgrades from what decks with this commander play on EDHREC, grouped
 * by category (recommendations spec), with v1's rules-based price tiers when EDHREC has nothing; and
 * v1's swap pairs and cheaper replacements. Searching happens on demand; after that, every deck
 * change recomputes the lists locally with no new requests.
 */
export function suggestionsPanel(
  ctx: AppContext,
  priced: () => PricedCard[],
  actions: PanelActions,
): {
  root: HTMLElement;
  refresh(): void;
  /** Starts a search as Find suggestions does; nothing happens while one is running. */
  find(): void;
  /** `fn` runs after every redraw of the panel, so an open card dialog can follow the pool as it loads. */
  onUpdate(fn: () => void): void;
  /** Cards similar to the deck card with this Oracle ID that fit the deck, from what the panel has loaded. */
  swapOptions(oracleId: string): SwapOptionsState;
} {
  let pool: PoolEntry[] | null = null;
  /** Set when every pool search failed. */
  let poolError = false;
  let edh: EdhState | null = null;
  let commanderName = '';
  let slug = '';
  /** The EDHREC page asked for; while a new one loads, `edh` still holds the one shown. */
  let filter: PageFilter = ALL_DECKS;
  /** Upgrades price filter, applied locally; Budget also reads EDHREC's budget decks. */
  let price: Tier | 'any' = 'any';
  /** Where the starting bracket came from, for the label beside the menu. */
  let bracketFrom: { kind: 'saved' } | { kind: 'estimated'; gameChangers: number } | { kind: 'unknown' } = { kind: 'unknown' };
  /** Cards looked up for this Find, so a filter change only looks up new names. */
  let known: KnownCards = new Map();
  /** Each EDHREC page load bumps this; an older page that answers late is ignored. */
  let pageRun = 0;
  let pageLoading = false;
  /** Set when a filter's page failed and the previous list is still shown. */
  let pageNote: string | null = null;
  /** Roles of EDHREC's best cards, looked up in the background for swaps and cheaper replacements. */
  let candidateRoles = new Map<string, string[]>();
  let candidateRolesState: 'idle' | 'loading' | 'ok' | 'approx' = 'idle';
  let candidateRun = 0;
  /** v1's rules-based searches start only when EDHREC has nothing for the commander. */
  let poolJob: Promise<void> | null = null;
  /** How many cards each Upgrades category shows; Show more raises it. */
  const shown = new Map<string, number>();
  /** Searches that didn't answer last time, named in a note. */
  let failedSearches: string[] = [];
  let roles = new Map<string, string[]>();
  /** The deck's own roles load after the pool; until then (or if that fails) swaps use roles seen in the pool. */
  let rolesState: 'loading' | 'ok' | 'approx' = 'loading';
  /** Each Find bumps this; replies from an earlier Find are ignored. */
  let run = 0;
  let profile: DeckProfile | null = null;
  let view: View = 'upgrades';
  let swapTier: Tier | null = null;

  const find = h('button', { type: 'button', class: 'button primary' }, 'Find suggestions');
  const undoBox = h('div', { class: 'undo-box' });
  const body = h('div', { class: 'stack' });
  const root = h(
    'aside',
    { class: 'suggestions stack', 'aria-labelledby': 'sugg-h' },
    h('h3', { id: 'sugg-h' }, 'Suggestions'),
    h('p', { class: 'muted small' }, 'Cards that fit this deck, legal in Commander and in your colors. Picked from what other decks with your commander play on EDHREC, or from your deck’s themes when EDHREC has no data.'),
    find,
    undoBox,
    body,
  );

  const facts = () => deckCardFacts(priced(), roles, pool ?? [], actions.collection(), candidateRoles);
  const ownedIds = () => new Set(actions.collection().owned);
  /** EDHREC's cards for the page shown, scored against the deck as it is now. */
  const edhrecScored = (res: Extract<EdhState, { status: 'ok' }>, oracleIds: Set<string>) =>
    scoreEdhrec(res.candidates, { colorIdentity: profile!.colorIdentity, oracleIds }, ownedIds(), commanderName, candidateRoles);

  /** Looks up the roles of the best EDHREC cards not yet checked (8 searches for 60 cards). */
  const lookupCandidateRoles = () => {
    if (edh?.status !== 'ok') return;
    const mine = run;
    const names = roleLookupNames(edhrecScored(edh, new Set(facts().map((c) => c.oracleId))));
    if (!names.length) return;
    // Bumped only when a lookup starts, so an earlier one still in flight can settle the state.
    const me = ++candidateRun;
    candidateRolesState = 'loading';
    deckRoles(ctx.client, names)
      .then(({ roles: found, complete }) => {
        if (mine !== run) return;
        // A partial answer still proves the roles it found; cards with none found stay unknown.
        for (const [id, r] of found) if (complete || r.length) candidateRoles.set(id, r);
        if (me === candidateRun) candidateRolesState = complete ? 'ok' : 'approx';
        draw();
      })
      .catch(() => {
        if (mine !== run || me !== candidateRun) return;
        candidateRolesState = 'approx';
        draw();
      });
  };

  const nameLink = (s: Suggestion) => h('a', { href: tcgplayerUrl(s.card, s.finish), target: '_blank', rel: 'noopener', class: 'sugg-name' }, s.card.name);
  const thumb = (s: Suggestion) => {
    const src = cardImage(s.card, 'small');
    return src ? h('img', { src, alt: '', loading: 'lazy', width: 146, height: 204, class: 'sugg-thumb' }) : h('span', { class: 'sugg-thumb' });
  };
  const busyButton = (label: string, aria: string, run: () => Promise<void>) => {
    const b = h('button', { type: 'button', class: 'button', 'aria-label': aria }, label);
    const err = h('span', { class: 'muted small', role: 'status' });
    b.addEventListener('click', async () => {
      b.disabled = true;
      b.textContent = 'Working…';
      err.textContent = '';
      try {
        await run();
      } catch {
        err.textContent = "Couldn't reach Scryfall. Try again.";
      } finally {
        // Usually the list redraws first; if not (a failure), the button is usable again.
        b.disabled = false;
        b.textContent = label;
      }
    });
    return h('span', { class: 'actions' }, b, err);
  };

  const suggItem = (s: Suggestion) =>
    h('li', { class: 'sugg' }, thumb(s), h('div', { class: 'sugg-body' }, h('div', { class: 'sugg-head' }, nameLink(s), h('span', { class: 'sugg-price' }, usd(s.price))), h('p', { class: 'muted small sugg-reason' }, s.reason), busyButton('Add', `Add ${s.card.name}`, () => actions.add(s.card))));

  /** Progress of the rules-based searches, updated in place so it doesn't redraw the panel. */
  const poolStatus = h('p', { class: 'muted small', role: 'status' }, 'Searching Scryfall…');
  const poolPending = () => (poolError ? h('p', { class: 'notice small', role: 'status' }, "Couldn't reach Scryfall. Check your connection and try again.") : poolStatus);

  const fallbackNote = (state: EdhState | null) =>
    !state || state.status === 'ok' || state.status === 'loading'
      ? null
      : h(
          'p',
          { class: 'notice small', role: 'status' },
          state.status === 'missing'
            ? `EDHREC has no decks for ${commanderName}, so these come from card rules, not real decks.`
            : state.status === 'failed'
              ? "EDHREC didn't answer, so these come from card rules, not real decks. Refresh suggestions to try again."
              : "Couldn't look up EDHREC's cards on Scryfall, so these come from card rules. Refresh suggestions to try again.",
        );

  /** Loads the EDHREC page for `want` and shows it; a failure keeps the list already shown. */
  const loadPage = async (want: PageFilter) => {
    const mine = run;
    const me = ++pageRun;
    filter = want;
    pageLoading = true;
    pageNote = null;
    draw();
    let res: EdhState;
    try {
      res = await edhrecCandidates(ctx.edhrec, ctx.client, { slug, filter: want, colorIdentity: profile!.colorIdentity, known });
    } catch {
      res = { status: 'lookup-failed' };
    }
    if (mine !== run || me !== pageRun) return;
    pageLoading = false;
    if (res.status === 'ok') {
      edh = res;
      filter = res.filter;
    } else if (edh?.status === 'ok') {
      filter = edh.filter;
      // Keep the price buttons in step with the page still shown.
      if (price === 'budget' && !filter.budget) price = 'any';
      pageNote =
        res.status === 'missing'
          ? 'EDHREC has no decks for that choice, so this is still the previous list.'
          : "EDHREC didn't answer for that choice, so this is still the previous list. Try again.";
    } else {
      edh = res;
      startPool();
    }
    // The lookup starts before the draw, so the card dialog's first redraw already knows roles are loading.
    if (res.status === 'ok') lookupCandidateRoles();
    draw();
  };

  /** v1's rules-based pool, for when EDHREC has nothing: price tiers, swaps and cheaper replacements. */
  const startPool = () => {
    if (poolJob || !profile) return;
    const mine = run;
    let done = 0;
    const tick = () => (poolStatus.textContent = `Searching Scryfall (${++done} searches done)…`);
    poolJob = candidatePool(ctx.client, profile, (n) => n && tick())
      .then((result) => {
        if (mine !== run) return;
        ({ pool, failed: failedSearches } = result);
        draw();
      })
      .catch(() => void (mine === run && ((poolError = true), draw())));
  };

  const select = (label: string, options: Array<{ value: string; label: string }>, current: string, onPick: (value: string) => void) => {
    const el = h('select', { 'aria-label': label }, ...options.map((o) => h('option', { value: o.value, selected: o.value === current }, o.label)));
    el.addEventListener('change', () => onPick(el.value));
    return h('label', { class: 'filter' }, h('span', { class: 'small' }, label), el);
  };

  const filters = (res: Extract<EdhState, { status: 'ok' }>): HTMLElement => {
    const counts = res.page.bracketCounts;
    const bracketMenu = select(
      'Bracket',
      [{ value: '0', label: 'All decks' }, ...BRACKETS.map((b) => ({ value: String(b.n), label: `${b.n} ${b.label}${counts[b.n] != null ? ` (${counts[b.n].toLocaleString('en-US')})` : ''}` }))],
      String(filter.bracket ?? 0),
      (v) => {
        const n = Number(v);
        actions.setBracket(n);
        bracketFrom = { kind: 'saved' };
        void loadPage({ ...filter, bracket: n || null });
      },
    );
    const themes = [...res.page.themes].sort((a, b) => b.count - a.count).slice(0, THEME_MENU);
    const current = filter.theme && !themes.some((t) => t.slug === filter.theme) ? [{ slug: filter.theme, label: filter.theme, count: 0 }] : [];
    const themeMenu = select(
      'Theme',
      [{ value: '', label: 'All themes' }, ...[...current, ...themes].map((t) => ({ value: t.slug, label: t.count ? `${t.label} (${t.count.toLocaleString('en-US')})` : t.label }))],
      filter.theme ?? '',
      (v) => void loadPage({ ...filter, theme: v || null }),
    );
    const estimate = bracketFrom.kind === 'estimated' && filter.bracket != null
      ? h('p', { class: 'muted small', 'data-testid': 'bracket-estimate' }, `Bracket estimated from your deck’s Game Changers (${bracketFrom.gameChangers}). Pick another to change it.`)
      : null;
    return h(
      'div',
      { class: 'stack' },
      h('div', { class: 'filters' }, bracketMenu, themeMenu),
      estimate,
      priceControl(() => {
        const budget = price === 'budget';
        if (budget !== filter.budget) void loadPage({ ...filter, budget });
        else draw();
      }),
    );
  };

  /** Upgrades price filter; `onPick` runs after `price` is set. */
  const priceControl = (onPick: () => void) =>
    segmented<Tier | 'any'>('Price', [{ id: 'any', label: 'Any price' }, ...TIERS.map((t) => ({ id: t.id, label: t.label }))], price, (p) => {
      price = p;
      onPick();
    });
  const inPrice = (s: Suggestion) => price === 'any' || tierOf(s.price) === price;

  /** Upgrades grouped by category: the top few of each, with Show more. */
  const categorySections = (groups: Array<{ category: string; items: Suggestion[] }>): HTMLElement[] =>
    groups.map(({ category, items }) => {
      const limit = shown.get(category) ?? CATEGORY_STEP;
      const more = h('button', { type: 'button', class: 'button', 'aria-label': `Show more ${category}` }, 'Show more');
      more.addEventListener('click', () => (shown.set(category, limit + CATEGORY_STEP), draw()));
      return h(
        'section',
        { class: 'sugg-group stack', 'aria-label': category },
        h('h4', {}, `${category} (${items.length})`),
        h('ul', { class: 'sugg-list', 'aria-label': `${category} upgrades` }, ...items.slice(0, limit).map(suggItem)),
        items.length > limit ? more : null,
      );
    });

  const edhrecUpgrades = (res: Extract<EdhState, { status: 'ok' }>, oracleIds: Set<string>): HTMLElement[] => {
    const scored = edhrecScored(res, oracleIds).filter(inPrice);
    // Card types the deck is short of, against the average deck on the page shown; their categories lead.
    const gaps = typeGaps(deckTypeCounts(priced().map((p) => ({ typeLine: p.typeLine, qty: p.entry.qty, isCommander: p.isCommander }))), res.page.typeCounts);
    const groups = byCategory(scored, gapCategories(gaps));
    const range = TIERS.find((t) => t.id === price)?.range;
    const thin = res.thinBracket;
    const thinLabel = thin && BRACKETS.find((b) => b.n === thin.bracket);
    const out: HTMLElement[] = [
      filters(res),
      pageLoading ? h('p', { class: 'muted small', role: 'status' }, 'Loading from EDHREC…') : null,
      pageNote ? h('p', { class: 'notice small', role: 'status' }, pageNote) : null,
      thin && thinLabel
        ? h(
            'p',
            { class: 'notice small', role: 'status' },
            `${thin.decks ? `Only ${thin.decks}` : 'No'} ${commanderName} ${thin.decks === 1 ? 'deck is' : 'decks are'} at bracket ${thin.bracket} ${thinLabel.label}${res.filter.theme ? ' with this theme' : ''}, so this shows all brackets.`,
          )
        : null,
      h(
        'p',
        { class: 'small', 'data-testid': 'edhrec-source' },
        'From ',
        h('a', { href: pageUrl(res.path), target: '_blank', rel: 'noopener' }, `${res.page.numDecks.toLocaleString('en-US')} ${commanderName} decks on EDHREC`),
        range ? `, cards ${range}, best fit first.` : ', best fit first.',
      ),
      gaps.length
        ? h(
            'div',
            { class: 'gaps', 'data-testid': 'gaps' },
            h('p', { class: 'small' }, `Compared with the average deck on this page, your deck is short of:`),
            h('ul', { class: 'small' }, ...gaps.map((g) => h('li', {}, `${g.label}: you run ${g.have}, typical is ${g.typical}`))),
          )
        : null,
    ].filter((x): x is HTMLElement => !!x);
    if (res.failedLookups) out.push(h('p', { class: 'notice small', role: 'status' }, "Scryfall didn't answer every lookup, so some cards may be missing. Refresh suggestions to try again."));
    if (!groups.length) out.push(h('p', { class: 'muted small' }, price === 'any' ? 'Your deck already runs every card EDHREC lists for this commander.' : 'No suggestions in this price range.'));
    out.push(...categorySections(groups));
    return out;
  };

  const drawUndo = () => {
    const label = actions.lastSwap();
    if (!label) return undoBox.replaceChildren();
    const btn = h('button', { type: 'button', class: 'button' }, 'Undo');
    btn.addEventListener('click', () => actions.undo());
    undoBox.replaceChildren(h('div', { class: 'banner row-between' }, h('p', { class: 'small' }, `Swapped ${label}.`), btn));
  };

  const rolesNote = () =>
    rolesState === 'loading'
      ? h('p', { class: 'muted small', role: 'status' }, 'Checking what your cards do (ramp, card draw, removal, board wipes)…')
      : rolesState === 'approx'
        ? h('p', { class: 'notice small', role: 'status' }, "Couldn't check what every card in your deck does, so matching cards by job is approximate. Refresh suggestions to try again.")
        : edh?.status === 'ok' && candidateRolesState === 'loading'
          ? h('p', { class: 'muted small', role: 'status' }, 'Checking what the suggested cards do; until then, cards are matched by type.')
          : edh?.status === 'ok' && candidateRolesState === 'approx'
            ? h('p', { class: 'notice small', role: 'status' }, "Couldn't check what every suggested card does, so some are matched by type. Refresh suggestions to try again.")
            : null;

  const render = () => {
    drawUndo();
    if (!profile) return;
    const deck = facts();
    const oracleIds = new Set(deck.map((c) => c.oracleId));
    const fromEdhrec = edh?.status === 'ok' ? edh : null;
    // Swaps and cheaper replacements use EDHREC's cards and scores when it answered, v1's pool otherwise.
    const scored = fromEdhrec ? edhrecScored(fromEdhrec, oracleIds) : pool ? scoreSuggestions(pool, { colorIdentity: profile.colorIdentity, oracleIds }, ownedIds()) : [];
    const colors = profile.colorIdentity.map((c) => COLOR_NAMES[c] ?? c).join(', ') || 'colorless';
    const line = [`Colors: ${colors}`, profile.tribe ? `Tribe: ${profile.tribe}` : null, profile.themes.length ? `Themes: ${profile.themes.map((t) => t.label).join(', ')}` : null];
    const parts: Array<HTMLElement | null> = [
      h('div', { class: 'profile', 'data-testid': 'deck-profile' }, h('p', { class: 'small' }, line.filter(Boolean).join(' · ')), deck.length < 6 ? h('p', { class: 'muted small' }, 'Add a few cards to get suggestions that match your themes.') : null),
      failedSearches.length
        ? h('p', { class: 'notice small', role: 'status' }, `Scryfall didn't answer every search (${failedSearches.join(', ')}), so some suggestions may be missing. Refresh suggestions to try again.`)
        : null,
      segmented('Suggestions', VIEWS, view, (v) => ((view = v), draw())),
    ];

    if (view === 'upgrades' && fromEdhrec) {
      parts.push(...edhrecUpgrades(fromEdhrec, oracleIds));
    } else if (edh?.status === 'loading') {
      parts.push(h('p', { class: 'muted small', role: 'status' }, `Loading what ${commanderName} decks play on EDHREC…`));
    } else if (!fromEdhrec && !pool) {
      parts.push(fallbackNote(edh), poolPending());
    } else if (view === 'upgrades') {
      // Rules-based upgrades: the same categories and price filter as EDHREC's, without its controls.
      const groups = byCategory(scored.filter(inPrice));
      const range = TIERS.find((t) => t.id === price)?.range;
      parts.push(
        fallbackNote(edh),
        priceControl(draw),
        h('p', { class: 'muted small' }, range ? `Cards ${range}, best fit first.` : 'Best fit first.'),
        ...(groups.length ? categorySections(groups) : [h('p', { class: 'muted small' }, price === 'any' ? 'No suggestions found for this deck.' : 'No suggestions in this price range.')]),
      );
    } else if (view === 'swaps') {
      const pairs = swapPairs(scored, deck, profile, { tier: swapTier ?? undefined, ...(fromEdhrec ? { keepScores: edhrecKeepScores(deck, fromEdhrec.page), matchType: true } : {}) });
      parts.push(
        rolesNote(),
        segmented<Tier | 'any'>('Swap price', [{ id: 'any', label: 'Any price' }, ...TIERS.map((t) => ({ id: t.id, label: t.label }))], swapTier ?? 'any', (t) => ((swapTier = t === 'any' ? null : t), draw())),
        h(
          'p',
          { class: 'muted small' },
          fromEdhrec
            ? `Each pick replaces the card ${commanderName} decks play least that does the same job, or else one of the same type, so the deck stays the same size. The commander, basic lands and cards you mark Keep are never cut.`
            : 'Each pick replaces your least-played card that does the same job, so the deck stays the same size. The commander, basic lands and cards you mark Keep are never cut.',
        ),
        pairs.length
          ? h(
              'ul',
              { class: 'sugg-list', 'aria-label': 'Swap pairs' },
              ...pairs.map(({ add, cut, sharedRole, sharedType }) => {
                return h(
                  'li',
                  { class: 'sugg' },
                  thumb(add),
                  h(
                    'div',
                    { class: 'sugg-body' },
                    h('p', { class: 'small swap-cut' }, 'Cut ', h('strong', {}, cut.name), cut.price != null ? ` (${usd(cut.price)})` : ''),
                    h('div', { class: 'sugg-head' }, h('span', {}, 'Add ', nameLink(add)), h('span', { class: 'sugg-price' }, usd(add.price))),
                    h('p', { class: 'muted small sugg-reason' }, [sharedRole ? `Both ${sharedRole}.` : sharedType ? `Both ${sharedType}.` : null, add.reason].filter(Boolean).join(' ')),
                    busyButton('Swap', `Swap ${cut.name} for ${add.card.name}`, () => actions.swap(cut.oracleId, add.card)),
                  ),
                );
              }),
            )
          : h('p', { class: 'muted small' }, 'No swaps that would improve the deck in this price range.'),
      );
    } else {
      const replacements = cheaperReplacements(deck, scored, 3, fromEdhrec ? { deckRolesKnown: rolesState === 'ok' } : {});
      parts.push(
        rolesNote(),
        h('p', { class: 'muted small' }, 'Cheaper cards that do the same job as your cards of $5 or more that you don’t own. Mark a card Keep to leave it out.'),
        replacements.length
          ? h(
              'div',
              { class: 'stack', 'aria-label': 'Cheaper replacements', role: 'group' },
              ...replacements.map(({ card, options }) => {
                return h(
                  'section',
                  { class: 'replace-group', 'aria-label': `Cheaper than ${card.name}` },
                  h('h4', {}, `${card.name} · ${usd(card.price!)}`),
                  h(
                    'ul',
                    { class: 'sugg-list' },
                    ...options.map(({ add, saves }) =>
                      h(
                        'li',
                        { class: 'sugg' },
                        thumb(add),
                        h(
                          'div',
                          { class: 'sugg-body' },
                          h('div', { class: 'sugg-head' }, nameLink(add), h('span', { class: 'sugg-price' }, usd(add.price))),
                          h('p', { class: 'small save' }, `Save ${usd(saves)}`),
                          h('p', { class: 'muted small sugg-reason' }, add.reason),
                          busyButton('Swap', `Swap ${card.name} for ${add.card.name}`, () => actions.swap(card.oracleId, add.card)),
                        ),
                      ),
                    ),
                  ),
                );
              }),
            )
          : h('p', { class: 'muted small' }, 'No cheaper replacements found for your cards of $5 or more.'),
      );
    }
    body.replaceChildren(...parts.filter((x): x is HTMLElement => !!x));
  };

  const listeners: Array<() => void> = [];
  const draw = () => {
    render();
    for (const fn of listeners) fn();
  };

  /** EDHREC's entry for a deck card, matched by loose front-face name as the keep scores are. */
  const pageEntry = (res: Extract<EdhState, { status: 'ok' }>, name: string) => {
    const key = looseName(frontFace(name));
    return res.page.cards.find((c) => looseName(frontFace(c.name)) === key);
  };

  const swapOptions = (oracleId: string): SwapOptionsState => {
    if (!profile) return { status: 'idle' };
    const cards = priced();
    const line = cards.find((p) => !p.isCommander && p.entry.card.oracleId === oracleId);
    if (!line?.card) return { status: 'unavailable' };
    const deck = facts();
    const oracleIds = new Set(deck.map((c) => c.oracleId));
    const mine = deck.find((c) => c.oracleId === oracleId);
    const tapped: Tapped = { card: line.card, oracleId, roles: mine?.roles ?? [], score: 0 };
    const checking = rolesState === 'loading' || (edh?.status === 'ok' && candidateRolesState === 'loading');
    if (edh?.status === 'ok') {
      tapped.score = edhrecKeepScores(deck, edh.page).get(oracleId) ?? 0;
      const entry = pageEntry(edh, line.entry.card.name);
      return {
        status: 'ready',
        source: 'edhrec',
        options: similarTo(tapped, edhrecScored(edh, oracleIds), profile),
        listed: !!entry,
        popularity: entry ? `In ${Math.round(entry.inclusion * 100)}% of ${commanderName} decks` : undefined,
        checking,
      };
    }
    if (pool) {
      // The rules scores aren't commander popularity, so nothing here can be a higher score on this commander's page.
      const options = similarTo(tapped, scoreSuggestions(pool, { colorIdentity: profile.colorIdentity, oracleIds }, ownedIds()), profile).map((o) => ({ ...o, betterFit: false }));
      return { status: 'ready', source: 'rules', options, listed: true, checking };
    }
    // EDHREC is still loading, or it had nothing and the rules-based pool is loading; a failed pool is all there is to say.
    return { status: poolError ? 'failed' : 'loading' };
  };

  /** Whether a search left anything to show: EDHREC's page, or the rules-based pool. (A function, so a run's awaits are not narrowed away.) */
  const hasResults = () => edh?.status === 'ok' || pool != null;

  find.addEventListener('click', async () => {
    const mine = ++run;
    const cards = priced();
    const commanderLine = cards.find((p) => p.isCommander);
    const commander = commanderLine?.card ?? null;
    commanderName = frontFace(commander?.name ?? commanderLine?.entry.card.name ?? '');
    profile = deckProfile(
      cards.map((p) => ({ name: p.entry.card.name, typeLine: p.typeLine, oracleText: rulesText(p.card), isCommander: p.isCommander })),
      commander?.color_identity ?? [],
    );
    pool = null;
    poolJob = null;
    poolError = false;
    candidateRoles = new Map();
    candidateRolesState = 'idle';
    failedSearches = [];
    roles = new Map();
    rolesState = 'loading';
    // Without the commander's Scryfall data its colors are unknown, so EDHREC's cards can't be checked.
    if (!commander) commanderName = '';
    edh = commanderName ? { status: 'loading' } : { status: 'failed' };
    slug = commanderSlug([commanderName]);
    known = new Map();
    pageNote = null;
    shown.clear();
    poolStatus.textContent = 'Searching Scryfall…';
    find.disabled = true;
    actions.onSearch('searching');
    draw();

    // The deck's own roles, for matching swaps and cheaper replacements by job. Started once the Upgrades list
    // has asked for what it needs: requests go out in the order they are made, two a second, and these
    // (a dozen searches) would otherwise hold up the list the panel opens on.
    const lookupDeckRoles = () =>
      deckRoles(ctx.client, cards.filter((c) => !c.isCommander).map((c) => ({ oracleId: c.entry.card.oracleId, name: c.entry.card.name })))
        .then(({ roles: r, complete }) => {
          if (mine !== run) return;
          roles = r;
          rolesState = complete ? 'ok' : 'approx';
          draw();
        })
        .catch(() => {
          if (mine !== run) return;
          rolesState = 'approx';
          draw();
        });

    // What decks with this commander play (EDHREC); v1's rules-based pool starts only if it has nothing.
    if (!commanderName) startPool();
    const fromEdhrec = !commanderName ? Promise.resolve() : (async () => {
      // Start at the deck's saved bracket, or one estimated from its Game Changers; if that search
      // fails, at all decks.
      const saved = actions.bracket();
      let bracket: number | null = null;
      if (saved != null) {
        bracket = saved || null;
        bracketFrom = { kind: 'saved' };
      } else {
        const gameChangers = await gameChangerCount(ctx.client, cards.map((c) => c.entry.card.oracleId));
        if (mine !== run) return;
        bracket = gameChangers == null ? null : estimateBracket(gameChangers);
        bracketFrom = gameChangers == null ? { kind: 'unknown' } : { kind: 'estimated', gameChangers };
      }
      await loadPage({ ...ALL_DECKS, bracket, budget: price === 'budget' });
    })();
    await fromEdhrec;
    if (mine === run) void lookupDeckRoles();
    await poolJob;
    if (mine === run) {
      find.disabled = false;
      find.textContent = 'Refresh suggestions';
      // Failed only when there is nothing to show: EDHREC gave no page and the rules-based fallback found no pool either.
      actions.onSearch(hasResults() ? 'ready' : 'failed');
    }
  });

  return {
    root,
    refresh: draw,
    find: () => {
      if (!find.disabled) find.click();
    },
    onUpdate: (fn) => void listeners.push(fn),
    swapOptions,
  };
}
