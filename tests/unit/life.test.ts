import { describe, expect, it } from 'vitest';
import {
  CMDR_LETHAL,
  DEFAULT_PLAYERS,
  HISTORY_LIMIT,
  LIFE_KEY,
  PALETTE,
  POISON_LETHAL,
  applyChange,
  changeLife,
  contrastWithWhite,
  defaultSetup,
  emptyLife,
  gameFromDefaults,
  loadLife,
  newGame,
  parseStartingLife,
  randomSeat,
  resetGame,
  saveLife,
  seatColor,
  seating,
  setColor,
  setFirst,
  setName,
  setPartners,
  undo,
  warnings,
  type Game,
} from '../../src/lib/life';

/** A Storage stand-in that can be told to fail. */
function fakeStorage(initial: Record<string, string> = {}, opts: { failGet?: boolean; failSet?: boolean } = {}): Storage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => {
      if (opts.failGet) throw new Error('blocked');
      return k in data ? data[k] : null;
    },
    setItem: (k: string, v: string) => {
      if (opts.failSet) throw new Error('full');
      data[k] = v;
    },
  } as unknown as Storage & { data: Record<string, string> };
}

describe('seating', () => {
  it.each([
    [1, [], [0]],
    [2, [1], [0]],
    [3, [1], [0, 2]],
    [4, [1, 2], [0, 3]],
    [5, [1, 2], [0, 4, 3]],
    [6, [1, 2, 3], [0, 5, 4]],
  ])('%i players: top %j, bottom %j (left to right, turn order clockwise from the bottom left)', (n, top, bottom) => {
    expect(seating(n)).toEqual({ top, bottom });
  });

  it('seats every player exactly once', () => {
    for (let n = 1; n <= 6; n++) {
      const { top, bottom } = seating(n);
      expect([...top, ...bottom].sort()).toEqual(Array.from({ length: n }, (_, i) => i));
    }
  });
});

describe('newGame', () => {
  it('starts every player at the starting life with default names', () => {
    const g = newGame({ players: 3, startingLife: 30, names: [], colors: [] });
    expect(g.players.map((p) => p.life)).toEqual([30, 30, 30]);
    expect(g.players.map((p) => p.name)).toEqual(['Player 1', 'Player 2', 'Player 3']);
    expect(g.startingLife).toBe(30);
  });

  it('uses set names, falls back for blank ones, and cuts long ones to 24 characters', () => {
    const g = newGame({ players: 3, startingLife: 40, names: ['Alex', '   ', 'x'.repeat(40)], colors: [] });
    expect(g.players[0].name).toBe('Alex');
    expect(g.players[1].name).toBe('Player 2');
    expect(g.players[2].name).toBe('x'.repeat(24));
  });
});

describe('changeLife', () => {
  it('changes only the chosen player and leaves the old game untouched', () => {
    const g = newGame({ ...defaultSetup(), players: 4 });
    const next = changeLife(g, 2, -10);
    expect(next.players.map((p) => p.life)).toEqual([40, 40, 30, 40]);
    expect(g.players[2].life).toBe(40);
  });

  it('goes below zero (nobody is eliminated automatically) and stops at the limits', () => {
    let g = newGame({ players: 1, startingLife: 1, names: [], colors: [] });
    g = changeLife(g, 0, -5);
    expect(g.players[0].life).toBe(-4);
    g = changeLife(g, 0, -100000);
    expect(g.players[0].life).toBe(-9999);
    g = changeLife(g, 0, 100000);
    expect(g.players[0].life).toBe(9999);
  });

  it('ignores a player that does not exist', () => {
    const g = newGame(defaultSetup());
    expect(changeLife(g, 9, 1)).toEqual(g);
  });
});

describe('parseStartingLife', () => {
  it.each([
    ['40', 40],
    [' 25 ', 25],
    ['1', 1],
    ['999', 999],
  ])('accepts %j', (text, n) => expect(parseStartingLife(text)).toBe(n));

  it.each(['', '0', '-5', '1000', '12.5', 'abc', '4e2', '1 2'])('rejects %j', (text) => expect(parseStartingLife(text)).toBeNull());
});

describe('loadLife and saveLife', () => {
  it('starts empty when nothing is saved', () => {
    const r = loadLife(fakeStorage());
    expect(r).toMatchObject({ persistent: true, future: false });
    expect(r.store).toEqual(emptyLife());
    expect(r.store.game).toBeNull();
  });

  it('round-trips a game and the setup', () => {
    const s = fakeStorage();
    const store = emptyLife();
    store.setup = { players: 3, startingLife: 30, names: ['A', 'B', 'C'], colors: [2, 0, 7] };
    store.game = changeLife(newGame(store.setup), 1, -4);
    expect(saveLife(s, store)).toBe(true);
    const back = loadLife(s).store;
    expect(back.game?.players.map((p) => p.life)).toEqual([30, 26, 30]);
    expect(back.setup).toEqual(store.setup);
  });

  it('works without storage: not persistent, nothing thrown', () => {
    expect(loadLife(null).persistent).toBe(false);
    expect(loadLife(fakeStorage({}, { failGet: true })).persistent).toBe(false);
    expect(saveLife(null, emptyLife())).toBe(false);
  });

  it('reports a failed save (storage full)', () => {
    expect(saveLife(fakeStorage({}, { failSet: true }), emptyLife())).toBe(false);
  });

  it('copies text that is not JSON to a backup key and starts empty', () => {
    const s = fakeStorage({ [LIFE_KEY]: '{oops' });
    const r = loadLife(s);
    expect(r.store.game).toBeNull();
    expect(s.data[`${LIFE_KEY}:backup`]).toBe('{oops');
  });

  it('also backs up JSON that is not an object', () => {
    const s = fakeStorage({ [LIFE_KEY]: '5' });
    expect(loadLife(s).store.game).toBeNull();
    expect(s.data[`${LIFE_KEY}:backup`]).toBe('5');
  });

  it.each([
    ['seven players', { players: Array.from({ length: 7 }, () => ({ name: 'x', life: 40 })) }],
    ['no players', { players: [] }],
    ['players not an array', { players: 'many' }],
    ['a life total that is a string', { players: [{ name: 'x', life: '40' }] }],
    ['a life total that is not finite', { players: [{ name: 'x', life: null }] }],
    ['a player that is not an object', { players: [4] }],
  ])('drops a saved game with %s', (_label, game) => {
    const s = fakeStorage({ [LIFE_KEY]: JSON.stringify({ version: 1, game: { startingLife: 40, ...game }, setup: {} }) });
    expect(loadLife(s).store.game).toBeNull();
  });

  it('clamps long names, and rounds and limits life totals', () => {
    const raw = { version: 1, game: { startingLife: 40, players: [{ name: 'y'.repeat(80), life: 12.6 }, { name: 'ok', life: 1e9 }] }, setup: {} };
    const g = loadLife(fakeStorage({ [LIFE_KEY]: JSON.stringify(raw) })).store.game!;
    expect(g.players[0]).toMatchObject({ name: 'y'.repeat(24), life: 13 });
    expect(g.players[1].life).toBe(9999);
  });

  it('repairs a bad setup to defaults', () => {
    const raw = { version: 1, game: null, setup: { players: 9, startingLife: 'lots', names: [1, 'ok'] } };
    const { setup } = loadLife(fakeStorage({ [LIFE_KEY]: JSON.stringify(raw) })).store;
    expect(setup.players).toBe(2);
    expect(setup.startingLife).toBe(40);
    expect(setup.names).toEqual(['', 'ok']);
    expect(setup.colors).toEqual([]);
  });

  it('ignores a game saved by a newer version, and says so, without touching it', () => {
    const raw = JSON.stringify({ version: 2, game: { whatever: true } });
    const s = fakeStorage({ [LIFE_KEY]: raw });
    const r = loadLife(s);
    expect(r.future).toBe(true);
    expect(r.store.game).toBeNull();
    expect(s.data[LIFE_KEY]).toBe(raw);
  });
});

describe('defaults', () => {
  const pair = { players: 2, startingLife: 40 };
  const loadWith = (defaults: unknown) => loadLife(fakeStorage({ [LIFE_KEY]: JSON.stringify({ version: 1, game: null, setup: {}, defaults }) })).store;

  it('start at 2 players and 40 life', () => {
    expect(DEFAULT_PLAYERS).toBe(2);
    expect(defaultSetup()).toMatchObject({ players: 2, startingLife: 40 });
    expect(emptyLife().setup).toMatchObject({ players: 2, startingLife: 40 });
    expect(emptyLife().defaults).toEqual(pair);
    expect(emptyLife().version).toBe(1);
  });

  it('load as the default pair from a store saved before defaults existed', () => {
    const raw = { version: 1, game: null, setup: { players: 3, startingLife: 30, names: [], colors: [] } };
    expect(loadLife(fakeStorage({ [LIFE_KEY]: JSON.stringify(raw) })).store.defaults).toEqual(pair);
  });

  it('load as saved', () => {
    expect(loadWith({ players: 4, startingLife: 30 }).defaults).toEqual({ players: 4, startingLife: 30 });
  });

  it('round-trip through saveLife', () => {
    const s = fakeStorage();
    const store = emptyLife();
    store.defaults = { players: 5, startingLife: 25 };
    saveLife(s, store);
    expect(loadLife(s).store.defaults).toEqual({ players: 5, startingLife: 25 });
  });

  it.each([
    ['players 0', { players: 0, startingLife: 30 }, { players: 2, startingLife: 30 }],
    ['players 7', { players: 7, startingLife: 30 }, { players: 2, startingLife: 30 }],
    ['players a string', { players: '4', startingLife: 30 }, { players: 2, startingLife: 30 }],
    ['players null', { players: null, startingLife: 30 }, { players: 2, startingLife: 30 }],
    ['players 2.6 (rounds to 3)', { players: 2.6, startingLife: 30 }, { players: 3, startingLife: 30 }],
    ['life 0 (clamps to 1)', { players: 4, startingLife: 0 }, { players: 4, startingLife: 1 }],
    ['life 1000 (clamps to 999)', { players: 4, startingLife: 1000 }, { players: 4, startingLife: 999 }],
    ['life NaN', { players: 4, startingLife: NaN }, { players: 4, startingLife: 40 }],
    ['life a string', { players: 4, startingLife: 'lots' }, { players: 4, startingLife: 40 }],
    ['an empty object', {}, pair],
    ['null', null, pair],
    ['an array', [4, 30], pair],
    ['a number', 4, pair],
  ])('with %s load as a repaired pair, never throwing', (_label, raw, expected) => {
    expect(loadWith(raw).defaults).toEqual(expected);
  });

  it('are left as the default pair, with the saved copy untouched, for a store from a newer version', () => {
    const raw = JSON.stringify({ version: 2, game: { whatever: true }, defaults: { players: 4, startingLife: 30 } });
    const s = fakeStorage({ [LIFE_KEY]: raw });
    const r = loadLife(s);
    expect(r.future).toBe(true);
    expect(r.store.game).toBeNull();
    expect(r.store.defaults).toEqual(pair);
    expect(s.data[LIFE_KEY]).toBe(raw);
  });
});

describe('gameFromDefaults', () => {
  it('takes players and life from defaults, names and colors from setup by seat', () => {
    const store = emptyLife();
    store.defaults = { players: 3, startingLife: 30 };
    store.setup = { players: 6, startingLife: 20, names: ['Ann', '', 'Cy'], colors: [5, -1, 2] };
    const g = gameFromDefaults(store);
    expect(g.startingLife).toBe(30);
    expect(g.players.map((p) => p.life)).toEqual([30, 30, 30]);
    expect(g.players.map((p) => p.name)).toEqual(['Ann', 'Player 2', 'Cy']);
    expect(g.players.map((p) => p.color)).toEqual([5, 1, 2]);
  });

  it('falls back to "Player N" and the seat color past the saved list', () => {
    const store = emptyLife();
    store.defaults = { players: 4, startingLife: 40 };
    store.setup = { players: 2, startingLife: 40, names: ['Ann'], colors: [6] };
    const g = gameFromDefaults(store);
    expect(g.players.map((p) => p.name)).toEqual(['Ann', 'Player 2', 'Player 3', 'Player 4']);
    expect(g.players.map((p) => p.color)).toEqual([6, 1, 2, 3]);
  });

  it('gives the plain default game (2 players, 40 life) from an empty store', () => {
    const g = gameFromDefaults(emptyLife());
    expect(g.players).toHaveLength(2);
    expect(g.players.map((p) => p.life)).toEqual([40, 40]);
    expect(g.history).toEqual([]);
    expect(g.first).toBeNull();
  });
});

describe('tile colors', () => {
  it('offers eight swatches that all keep white text readable (WCAG AA, 4.5:1)', () => {
    expect(PALETTE).toHaveLength(8);
    for (const c of PALETTE) expect(contrastWithWhite(c.hex), c.name).toBeGreaterThanOrEqual(4.5);
  });

  it('computes known contrast ratios', () => {
    expect(contrastWithWhite('#000000')).toBeCloseTo(21, 0);
    expect(contrastWithWhite('#ffffff')).toBeCloseTo(1, 5);
  });
});

const three = (): Game => newGame({ players: 3, startingLife: 40, names: ['Ann', 'Ben', 'Cy'], colors: [] });
const cmdr = (from: number, slot: 0 | 1 = 0) => ({ kind: 'cmdr', from, slot }) as const;

describe('poison', () => {
  it('counts up from zero, never below, and stops at 99', () => {
    let g = three();
    g = applyChange(g, 0, { kind: 'poison' }, 3);
    expect(g.players[0].poison).toBe(3);
    g = applyChange(g, 0, { kind: 'poison' }, -10);
    expect(g.players[0].poison).toBe(0);
    g = applyChange(g, 0, { kind: 'poison' }, 500);
    expect(g.players[0].poison).toBe(99);
  });

  it('leaves life alone', () => {
    const g = applyChange(three(), 1, { kind: 'poison' }, 5);
    expect(g.players.map((p) => p.life)).toEqual([40, 40, 40]);
  });
});

describe('commander damage', () => {
  it('is tracked per opponent and never touches life', () => {
    let g = three();
    g = applyChange(g, 0, cmdr(1), 4);
    g = applyChange(g, 0, cmdr(2), 7);
    expect(g.players[0].cmdr).toEqual({ '1:0': 4, '2:0': 7 });
    expect(g.players[0].life).toBe(40);
  });

  it('refuses damage from yourself, from nobody, and from a partner that is not set', () => {
    const g = three();
    expect(applyChange(g, 0, cmdr(0), 1)).toBe(g);
    expect(applyChange(g, 0, cmdr(7), 1)).toBe(g);
    expect(applyChange(g, 0, cmdr(1, 1), 1)).toBe(g);
  });

  it('tracks a partner pair separately', () => {
    let g = setPartners(three(), 1, true);
    g = applyChange(g, 0, cmdr(1, 0), 12);
    g = applyChange(g, 0, cmdr(1, 1), 3);
    expect(g.players[0].cmdr).toEqual({ '1:0': 12, '1:1': 3 });
  });

  it('turning partners off drops that partner\'s damage and its undo entries, and keeps the rest', () => {
    let g = setPartners(three(), 1, true);
    g = applyChange(g, 0, cmdr(1, 0), 2);
    g = applyChange(g, 0, cmdr(1, 1), 3);
    g = applyChange(g, 2, cmdr(1, 1), 4);
    g = setPartners(g, 1, false);
    expect(g.players[0].cmdr).toEqual({ '1:0': 2 });
    expect(g.players[2].cmdr).toEqual({});
    expect(g.players[1].partners).toBe(false);
    expect(g.history).toHaveLength(1);
    expect(undo(g).players[0].cmdr).toEqual({});
  });
});

describe('warnings (nothing is ever eliminated)', () => {
  it.each([
    [1, false],
    [0, true],
    [-3, true],
  ])('life %i warns: %s', (life, warns) => {
    const g = applyChange(newGame({ players: 1, startingLife: 1, names: [], colors: [] }), 0, { kind: 'life' }, life - 1);
    expect(warnings(g, 0).includes('Life 0 or below')).toBe(warns);
  });

  it(`poison warns from ${POISON_LETHAL}, not at ${POISON_LETHAL - 1}`, () => {
    let g = applyChange(three(), 0, { kind: 'poison' }, POISON_LETHAL - 1);
    expect(warnings(g, 0)).toEqual([]);
    g = applyChange(g, 0, { kind: 'poison' }, 1);
    expect(warnings(g, 0)).toEqual(['Poison 10']);
  });

  it(`commander damage warns from ${CMDR_LETHAL} per commander, not at ${CMDR_LETHAL - 1}`, () => {
    let g = applyChange(three(), 0, cmdr(1), CMDR_LETHAL - 1);
    expect(warnings(g, 0)).toEqual([]);
    g = applyChange(g, 0, cmdr(1), 1);
    expect(warnings(g, 0)).toEqual(['Commander damage 21 from Ben']);
  });

  it('judges each commander of a partner pair on its own, so 15 + 15 does not warn', () => {
    let g = setPartners(three(), 1, true);
    g = applyChange(g, 0, cmdr(1, 0), 15);
    g = applyChange(g, 0, cmdr(1, 1), 15);
    expect(warnings(g, 0)).toEqual([]);
    g = applyChange(g, 0, cmdr(1, 1), 6);
    expect(warnings(g, 0)).toEqual(["Commander damage 21 from Ben's partner"]);
  });

  it('keeps counting after a warning', () => {
    let g = applyChange(three(), 0, { kind: 'poison' }, 10);
    g = applyChange(g, 0, { kind: 'poison' }, 1);
    expect(g.players[0].poison).toBe(11);
  });
});

describe('undo', () => {
  it('does nothing with an empty history', () => {
    const g = three();
    expect(undo(g)).toBe(g);
  });

  it('puts back the last change by anyone, most recent first', () => {
    let g = three();
    g = changeLife(g, 0, -3);
    g = applyChange(g, 1, { kind: 'poison' }, 2);
    g = applyChange(g, 2, cmdr(0), 5);
    g = undo(g);
    expect(g.players[2].cmdr).toEqual({});
    g = undo(g);
    expect(g.players[1].poison).toBe(0);
    g = undo(g);
    expect(g.players[0].life).toBe(40);
    expect(g.history).toEqual([]);
  });

  it('does not record a change that did not change anything', () => {
    let g = applyChange(three(), 0, { kind: 'poison' }, -1);
    expect(g.history).toEqual([]);
    g = changeLife(newGame({ players: 1, startingLife: 9999, names: [], colors: [] }), 0, 5);
    expect(g.history).toEqual([]);
  });

  it('restores the exact earlier value after a clamped change', () => {
    let g = changeLife(newGame({ players: 1, startingLife: 9998, names: [], colors: [] }), 0, 50);
    expect(g.players[0].life).toBe(9999);
    expect(undo(g).players[0].life).toBe(9998);
  });

  it(`keeps only the last ${HISTORY_LIMIT} changes`, () => {
    let g = newGame({ players: 1, startingLife: 100, names: [], colors: [] });
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) g = changeLife(g, 0, -1);
    expect(g.history).toHaveLength(HISTORY_LIMIT);
    for (let i = 0; i < HISTORY_LIMIT; i++) g = undo(g);
    expect(g.players[0].life).toBe(100 - 10);
    expect(undo(g)).toBe(g);
  });

  it('leaves the old game untouched', () => {
    const g = changeLife(three(), 0, -1);
    undo(g);
    expect(g.players[0].life).toBe(39);
    expect(g.history).toHaveLength(1);
  });
});

describe('resetGame', () => {
  it('puts every counter back, keeps names and partners, and forgets the history so undo has nothing', () => {
    let g = setPartners(three(), 1, true);
    g = changeLife(g, 0, -12);
    g = applyChange(g, 0, { kind: 'poison' }, 4);
    g = applyChange(g, 0, cmdr(1, 1), 6);
    const r = resetGame(g);
    expect(r.players.map((p) => [p.name, p.life, p.poison, p.cmdr, p.partners])).toEqual([
      ['Ann', 40, 0, {}, false],
      ['Ben', 40, 0, {}, true],
      ['Cy', 40, 0, {}, false],
    ]);
    expect(r.history).toEqual([]);
    expect(undo(r)).toBe(r);
  });
});

describe('saved counters', () => {
  const roundTrip = (game: unknown) => loadLife(fakeStorage({ [LIFE_KEY]: JSON.stringify({ version: 1, game, setup: {} }) })).store.game;

  it('round-trips poison, commander damage, partners and the undo history', () => {
    let g = setPartners(three(), 1, true);
    g = applyChange(g, 0, { kind: 'poison' }, 2);
    g = applyChange(g, 0, cmdr(1, 1), 6);
    const s = fakeStorage();
    const store = emptyLife();
    store.game = g;
    saveLife(s, store);
    expect(loadLife(s).store.game).toEqual(g);
  });

  it('reads a game saved before these counters existed', () => {
    const g = roundTrip({ startingLife: 40, players: [{ name: 'A', life: 38 }, { name: 'B', life: 40 }] })!;
    expect(g.players[0]).toEqual({ name: 'A', life: 38, poison: 0, partners: false, cmdr: {}, color: 0 });
    expect(g.first).toBeNull();
    expect(g.history).toEqual([]);
  });

  it('repairs bad counters: out-of-range values are limited, impossible rows and non-boolean partners are dropped', () => {
    const g = roundTrip({
      startingLife: 40,
      players: [
        { name: 'A', life: 40, poison: 500, partners: 'yes', cmdr: { '1:0': 5, '0:0': 3, '1:1': 4, '2:1': 2, '9:0': 2, 'x': 1, '1:0 ': 1 } },
        { name: 'B', life: 40, poison: -4, partners: true, cmdr: { '0:1': 200, '0:0': 'lots' } },
        { name: 'C', life: 40 },
      ],
    })!;
    expect(g.players[0].poison).toBe(99);
    expect(g.players[0].partners).toBe(false);
    // Kept: from B, whose commander has a partner. Dropped: from yourself, from C (no partner), from nobody, malformed keys.
    expect(g.players[0].cmdr).toEqual({ '1:0': 5, '1:1': 4 });
    expect(g.players[1].poison).toBe(0);
    expect(g.players[1].cmdr).toEqual({});
  });

  it('drops history entries that are not valid and keeps the valid ones', () => {
    const g = roundTrip({
      startingLife: 40,
      players: [{ name: 'A', life: 39 }, { name: 'B', life: 40 }],
      history: [
        { seat: 0, target: { kind: 'life' }, before: 40 },
        { seat: 5, target: { kind: 'life' }, before: 40 },
        { seat: 0, target: { kind: 'nope' }, before: 1 },
        { seat: 0, target: { kind: 'cmdr', from: 0, slot: 0 }, before: 1 },
        { seat: 0, target: { kind: 'life' }, before: 'x' },
        'junk',
      ],
    })!;
    expect(g.history).toEqual([{ seat: 0, target: { kind: 'life' }, before: 40 }]);
  });

  it('drops a history that is not a list, and cuts a long one to the last 50', () => {
    expect(roundTrip({ startingLife: 40, players: [{ name: 'A', life: 40 }], history: 'many' })!.history).toEqual([]);
    const many = Array.from({ length: 80 }, (_, i) => ({ seat: 0, target: { kind: 'life' }, before: i }));
    const g = roundTrip({ startingLife: 40, players: [{ name: 'A', life: 40 }], history: many })!;
    expect(g.history).toHaveLength(HISTORY_LIMIT);
    expect(g.history[0].before).toBe(30);
  });
});

describe('names and colors', () => {
  it('gives each seat its own color by default, and uses the setup colors when they are valid', () => {
    const g = newGame({ players: 4, startingLife: 40, names: [], colors: [] });
    expect(g.players.map((p) => p.color)).toEqual([0, 1, 2, 3]);
    const picked = newGame({ players: 4, startingLife: 40, names: [], colors: [5, 5, 99, -1] });
    expect(picked.players.map((p) => p.color)).toEqual([5, 5, 2, 3]);
  });

  it('seatColor falls back to the seat for anything that is not a swatch index', () => {
    for (const bad of [-1, 8, 1.5, NaN, '3', null, undefined]) expect(seatColor(bad, 4)).toBe(4);
    expect(seatColor(7, 0)).toBe(7);
    expect(seatColor(0, 5)).toBe(0);
  });

  it('setName trims, cuts to 24 characters, and falls back to the default for a blank name', () => {
    let g = setName(three(), 0, '  Zed  ');
    expect(g.players[0].name).toBe('Zed');
    g = setName(g, 1, 'y'.repeat(40));
    expect(g.players[1].name).toBe('y'.repeat(24));
    g = setName(g, 2, '   ');
    expect(g.players[2].name).toBe('Player 3');
    expect(setName(g, 9, 'x')).toBe(g);
  });

  it('setColor changes only the color, ignores a bad index, and is not undoable', () => {
    const g = three();
    const next = setColor(g, 1, 6);
    expect(next.players[1].color).toBe(6);
    expect(next.players[0].color).toBe(0);
    expect(next.history).toEqual([]);
    expect(setColor(g, 1, 8)).toBe(g);
    expect(setColor(g, 1, -1)).toBe(g);
    expect(setColor(g, 9, 2)).toBe(g);
  });

  it('keeps names and colors through undo and reset', () => {
    let g = setColor(setName(three(), 0, 'Zed'), 0, 4);
    g = changeLife(g, 0, -3);
    g = undo(g);
    expect(g.players[0]).toMatchObject({ name: 'Zed', color: 4 });
    expect(resetGame(g).players[0]).toMatchObject({ name: 'Zed', color: 4 });
  });

  it('saves and repairs names, colors and the setup colors', () => {
    const raw = { version: 1, game: { startingLife: 40, players: [{ name: 'A', life: 40, color: 6 }, { name: 'B', life: 40, color: 'red' }, { name: 'C', life: 40, color: 40 }] }, setup: { colors: [1, 'x', 9, 3], names: [] } };
    const { store } = loadLife(fakeStorage({ [LIFE_KEY]: JSON.stringify(raw) }));
    expect(store.game!.players.map((p) => p.color)).toEqual([6, 1, 2]);
    expect(store.setup.colors).toEqual([1, -1, -1, 3]);
  });
});

describe('first player', () => {
  it('is nobody until rolled, and setFirst names a seat or clears it', () => {
    const g = three();
    expect(g.first).toBeNull();
    expect(setFirst(g, 2).first).toBe(2);
    expect(setFirst(setFirst(g, 2), null).first).toBeNull();
    expect(setFirst(g, 3)).toBe(g);
    expect(setFirst(g, -1)).toBe(g);
    expect(setFirst(g, 1.5)).toBe(g);
  });

  it('is not an undoable change, and a reset clears it (a restarted game rolls again)', () => {
    const g = setFirst(changeLife(three(), 0, -1), 1);
    expect(g.history).toHaveLength(1);
    expect(undo(g).first).toBe(1);
    expect(resetGame(g).first).toBeNull();
  });

  it('is saved, and dropped when it points at a seat that does not exist', () => {
    const base = { startingLife: 40, players: [{ name: 'A', life: 40 }, { name: 'B', life: 40 }] };
    const load = (first: unknown) => loadLife(fakeStorage({ [LIFE_KEY]: JSON.stringify({ version: 1, game: { ...base, first }, setup: {} }) })).store.game!.first;
    expect(load(1)).toBe(1);
    expect(load(2)).toBeNull();
    expect(load(-1)).toBeNull();
    expect(load('1')).toBeNull();
    expect(load(0.5)).toBeNull();
    expect(load(undefined)).toBeNull();
  });
});

describe('randomSeat', () => {
  it('picks the seat the random number lands on', () => {
    expect(randomSeat(6, () => 0)).toBe(0);
    expect(randomSeat(6, () => 5)).toBe(5);
    expect(randomSeat(6, () => 7)).toBe(1);
    expect(randomSeat(1, () => 123456)).toBe(0);
  });

  it('throws away numbers from the uneven tail so no seat is favoured', () => {
    // 2^32 is not a multiple of 6: 4294967292.. are rejected, the next draw is used.
    const draws = [4294967295, 4294967292, 8];
    expect(randomSeat(6, () => draws.shift()!)).toBe(2);
    expect(draws).toEqual([]);
  });

  it('reaches every seat and stays in range with the real random source', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const n = randomSeat(4);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(4);
      seen.add(n);
    }
    expect(seen.size).toBe(4);
  });
});
