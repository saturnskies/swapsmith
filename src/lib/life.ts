import type { ArtRef } from './art';

/** Life Counter game state and its saved copy. Pure: no DOM. Kept under its own key, apart from the deck store (see the spec). */

export const LIFE_KEY = 'swapsmith:life';
export const MAX_PLAYERS = 6;
export const MAX_NAME = 24;
export const LIFE_LIMIT = 9999;
export const LIFE_PRESETS = [20, 30, 40] as const;
export const DEFAULT_LIFE = 40;
export const DEFAULT_PLAYERS = 2;

export const POISON_LETHAL = 10;
export const CMDR_LETHAL = 21;
export const COUNTER_LIMIT = 99;
export const HISTORY_LIMIT = 50;

export interface Player {
  name: string;
  life: number;
  poison: number;
  /** Index into PALETTE. */
  color: number;
  /** This player's commander has a partner: opponents track damage from each separately. */
  partners: boolean;
  /** Commander damage this player has taken, by `${seat}:${slot}` of the dealing commander (slot 1 = the partner). Zero entries are absent. */
  cmdr: Record<string, number>;
  /** The card art behind this seat's tile, when one was chosen. */
  art?: ArtRef;
  /** A `#rrggbb` accent that overrides the palette swatch, when one was chosen. */
  accent?: string;
}

/** What a change touches: life, poison, or the damage taken from one commander. */
export type Target = { kind: 'life' } | { kind: 'poison' } | { kind: 'cmdr'; from: number; slot: 0 | 1 };

/** One undoable change: which counter of which player, and the value it had before. */
export interface Change {
  seat: number;
  target: Target;
  before: number;
}

export interface Game {
  startingLife: number;
  players: Player[];
  /** The last changes, oldest first, at most HISTORY_LIMIT. */
  history: Change[];
  /** Who goes first, once rolled. Not an undoable change. */
  first: number | null;
}

/** The names and colors, and the last-used players and starting life, remembered for the next game. */
export interface Setup {
  players: number;
  startingLife: number;
  /** Typed names by seat; '' means the default "Player N". */
  names: string[];
  /** Typed colors by seat: a PALETTE index, or -1 for the seat's own default. */
  colors: number[];
  /** Chosen art by seat; null or absent means none. */
  arts?: (ArtRef | null)[];
  /** Chosen `#rrggbb` accents by seat; null or absent means none. */
  accents?: (string | null)[];
}

/** The player count and starting life a new game opens with (the Life Counter's saved default). */
export interface Defaults {
  players: number;
  startingLife: number;
}

export interface LifeStore {
  version: 1;
  game: Game | null;
  setup: Setup;
  defaults: Defaults;
}

/** Tile colors: each keeps white text at 4.5:1 or better (checked in tests). */
export const PALETTE = [
  { id: 'red', name: 'Red', hex: '#b3261e' },
  { id: 'green', name: 'Green', hex: '#1b6b3a' },
  { id: 'blue', name: 'Blue', hex: '#1d4e9e' },
  { id: 'purple', name: 'Purple', hex: '#6b3fa0' },
  { id: 'orange', name: 'Orange', hex: '#9a4f00' },
  { id: 'teal', name: 'Teal', hex: '#00695c' },
  { id: 'magenta', name: 'Magenta', hex: '#a1205f' },
  { id: 'slate', name: 'Slate', hex: '#4a5560' },
] as const;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** WCAG contrast ratio of white text on the given `#rrggbb` color. */
export function contrastWithWhite(hex: string): number {
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (lum + 0.05);
}

export function defaultSetup(): Setup {
  return { players: DEFAULT_PLAYERS, startingLife: DEFAULT_LIFE, names: [], colors: [] };
}

export function emptyLife(): LifeStore {
  return { version: 1, game: null, setup: defaultSetup(), defaults: { players: DEFAULT_PLAYERS, startingLife: DEFAULT_LIFE } };
}

/** A typed custom starting life: whole numbers 1–999 only, else null. */
export function parseStartingLife(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= 999 ? n : null;
}

const cleanName = (name: string, seat: number) => name.trim().slice(0, MAX_NAME) || `Player ${seat + 1}`;

const isSwatch = (c: unknown): c is number => typeof c === 'number' && Number.isInteger(c) && c >= 0 && c < PALETTE.length;

/** A swatch index, or the seat's own default color when `c` isn't one. */
export function seatColor(c: unknown, seat: number): number {
  return isSwatch(c) ? c : seat % PALETTE.length;
}

const isObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

const ART_ID_MAX = 64;
const ART_TEXT_MAX = 80;
const ART_URL_MAX = 300;

const text = (x: unknown, max: number): x is string => typeof x === 'string' && x.length >= 1 && x.length <= max;

/** The art reference `x` describes, copied field by field, or null when any field is missing, oversized or the `url` is not plain https. */
export function sanitizeArt(x: unknown): ArtRef | null {
  if (!isObject(x) || !text(x.id, ART_ID_MAX) || !text(x.cardId, ART_ID_MAX) || !text(x.name, ART_TEXT_MAX) || !text(x.artist, ART_TEXT_MAX) || !text(x.url, ART_URL_MAX)) return null;
  try {
    const u = new URL(x.url);
    if (u.protocol !== 'https:' || !u.hostname) return null;
  } catch {
    return null;
  }
  return { id: x.id, cardId: x.cardId, name: x.name, artist: x.artist, url: x.url };
}

/** `x` as a lowercase `#rrggbb`, or null when it isn't one. */
export function sanitizeAccent(x: unknown): string | null {
  return typeof x === 'string' && /^#[0-9a-fA-F]{6}$/.test(x) ? x.toLowerCase() : null;
}

/** A player's optional art and accent as they should appear on the record: only the ones that are valid. */
function looks(art: unknown, accent: unknown): Pick<Player, 'art' | 'accent'> {
  const a = sanitizeArt(art);
  const c = sanitizeAccent(accent);
  return { ...(a ? { art: a } : {}), ...(c ? { accent: c } : {}) };
}

export function newGame(setup: Setup): Game {
  const n = clamp(Math.round(setup.players), 1, MAX_PLAYERS);
  return {
    startingLife: setup.startingLife,
    players: Array.from({ length: n }, (_, i) => ({ name: cleanName(setup.names[i] ?? '', i), life: setup.startingLife, poison: 0, color: seatColor(setup.colors[i], i), partners: false, cmdr: {}, ...looks(setup.arts?.[i], setup.accents?.[i]) })),
    history: [],
    first: null,
  };
}

/** The game the Life Counter opens into: the saved defaults for players and life, with names and colors from `store.setup` by seat. */
export function gameFromDefaults(store: LifeStore): Game {
  const d = store.defaults;
  return newGame({ ...store.setup, players: d.players, startingLife: d.startingLife });
}

const key = (from: number, slot: number) => `${from}:${slot}`;
const range = (t: Target): [number, number] => (t.kind === 'life' ? [-LIFE_LIMIT, LIFE_LIMIT] : [0, COUNTER_LIMIT]);

function valueOf(p: Player, t: Target): number {
  return t.kind === 'life' ? p.life : t.kind === 'poison' ? p.poison : (p.cmdr[key(t.from, t.slot)] ?? 0);
}

function withValue(p: Player, t: Target, v: number): Player {
  if (t.kind === 'life') return { ...p, life: v };
  if (t.kind === 'poison') return { ...p, poison: v };
  const cmdr = { ...p.cmdr };
  if (v === 0) delete cmdr[key(t.from, t.slot)];
  else cmdr[key(t.from, t.slot)] = v;
  return { ...p, cmdr };
}

/** Whether `t` names a counter this game has: a real opponent, and a partner only if that player has one. */
function exists(game: Game, seat: number, t: Target): boolean {
  if (!game.players[seat]) return false;
  if (t.kind !== 'cmdr') return true;
  const dealer = game.players[t.from];
  return !!dealer && t.from !== seat && (t.slot === 0 || dealer.partners);
}

/** The current value of one counter (0 for one that doesn't exist). */
export function counter(game: Game, seat: number, t: Target): number {
  return exists(game, seat, t) ? valueOf(game.players[seat], t) : 0;
}

/**
 * Returns a new game with one counter changed by `delta`, limited to its range, and the change remembered for undo.
 * A change that doesn't change anything (already at the limit) or names a counter that doesn't exist returns the same game.
 * Commander damage never changes life: players adjust life themselves.
 */
export function applyChange(game: Game, seat: number, t: Target, delta: number): Game {
  if (!exists(game, seat, t)) return game;
  const before = valueOf(game.players[seat], t);
  const [lo, hi] = range(t);
  const next = clamp(before + delta, lo, hi);
  if (next === before) return game;
  return {
    ...game,
    players: game.players.map((p, i) => (i === seat ? withValue(p, t, next) : p)),
    history: [...game.history, { seat, target: t, before }].slice(-HISTORY_LIMIT),
  };
}

/** Returns a new game with one player's life changed by `delta`. */
export const changeLife = (game: Game, seat: number, delta: number): Game => applyChange(game, seat, { kind: 'life' }, delta);

/** Takes back the most recent change by anyone; with nothing to take back returns the same game. */
export function undo(game: Game): Game {
  const last = game.history[game.history.length - 1];
  if (!last) return game;
  return { ...game, players: game.players.map((p, i) => (i === last.seat ? withValue(p, last.target, last.before) : p)), history: game.history.slice(0, -1) };
}

/** Marks a player's commander as having a partner or not. Turning it off drops the damage dealt by the partner, and its undo entries. */
export function setPartners(game: Game, seat: number, on: boolean): Game {
  if (!game.players[seat] || game.players[seat].partners === on) return game;
  const gone = key(seat, 1);
  const dropped = (t: Target) => !on && t.kind === 'cmdr' && t.from === seat && t.slot === 1;
  return {
    ...game,
    players: game.players.map((p, i) => {
      const own = i === seat ? { ...p, partners: on } : p;
      if (on || !(gone in own.cmdr)) return own;
      const cmdr = { ...own.cmdr };
      delete cmdr[gone];
      return { ...own, cmdr };
    }),
    history: game.history.filter((c) => !dropped(c.target)),
  };
}

/** Starts the same game over: life back to the starting total, no poison or commander damage, no undo, nobody first yet. Names, colors and partners stay. */
export function resetGame(game: Game): Game {
  return { ...game, players: game.players.map((p) => ({ ...p, life: game.startingLife, poison: 0, cmdr: {} })), history: [], first: null };
}

/** Renames a player (trimmed, at most 24 characters; blank gives the default "Player N"). Not an undoable change. */
export function setName(game: Game, seat: number, name: string): Game {
  if (!game.players[seat]) return game;
  return { ...game, players: game.players.map((p, i) => (i === seat ? { ...p, name: cleanName(name, seat) } : p)) };
}

/** Gives a player a swatch from PALETTE; anything else changes nothing. Not an undoable change. */
export function setColor(game: Game, seat: number, color: number): Game {
  if (!game.players[seat] || !isSwatch(color)) return game;
  return { ...game, players: game.players.map((p, i) => (i === seat ? { ...p, color } : p)) };
}

/** Gives a player card art, or takes it away with null. A malformed art changes nothing. Not an undoable change. */
export function setArt(game: Game, seat: number, art: ArtRef | null): Game {
  const clean = art == null ? null : sanitizeArt(art);
  if (!game.players[seat] || (art != null && !clean)) return game;
  return { ...game, players: game.players.map((p, i) => {
    if (i !== seat) return p;
    const { art: _gone, ...rest } = p;
    return clean ? { ...rest, art: clean } : rest;
  }) };
}

/** Gives a player an accent color (`#rrggbb`), or takes it away with null. Anything else changes nothing. Not an undoable change. */
export function setAccent(game: Game, seat: number, hex: string | null): Game {
  const clean = hex == null ? null : sanitizeAccent(hex);
  if (!game.players[seat] || (hex != null && !clean)) return game;
  return { ...game, players: game.players.map((p, i) => {
    if (i !== seat) return p;
    const { accent: _gone, ...rest } = p;
    return clean ? { ...rest, accent: clean } : rest;
  }) };
}

/** Marks who goes first (or nobody); a seat that doesn't exist changes nothing. */
export function setFirst(game: Game, seat: number | null): Game {
  if (seat != null && !(Number.isInteger(seat) && game.players[seat])) return game;
  return { ...game, first: seat };
}

const uint32 = () => crypto.getRandomValues(new Uint32Array(1))[0];

/** A fair random seat in 0..n-1. Numbers from the uneven tail of the 32-bit range are redrawn so no seat is favoured. */
export function randomSeat(n: number, draw: () => number = uint32): number {
  const limit = Math.floor(2 ** 32 / n) * n;
  let x = draw();
  while (x >= limit) x = draw();
  return x % n;
}

/** Why a player is in danger, if they are. Only a warning: nobody is ever eliminated automatically. */
export function warnings(game: Game, seat: number): string[] {
  const p = game.players[seat];
  if (!p) return [];
  const out: string[] = [];
  if (p.life <= 0) out.push('Life 0 or below');
  if (p.poison >= POISON_LETHAL) out.push(`Poison ${p.poison}`);
  for (const [k, v] of Object.entries(p.cmdr)) {
    if (v < CMDR_LETHAL) continue;
    const [from, slot] = k.split(':').map(Number);
    out.push(`Commander damage ${v} from ${game.players[from]?.name ?? 'a player'}${slot === 1 ? "'s partner" : ''}`);
  }
  return out;
}

/**
 * Who sits where, as player indexes left to right on each long edge. Turn order runs clockwise from the
 * bottom left: up the left side, along the top, down the right side, back along the bottom.
 */
export function seating(n: number): { top: number[]; bottom: number[] } {
  const top = Math.floor(n / 2);
  const along = Array.from({ length: top }, (_, i) => i + 1);
  const rest = Array.from({ length: n - top - 1 }, (_, i) => top + 1 + i);
  return { top: along, bottom: [0, ...rest.reverse()] };
}

// ---- saved copy ----

const whole = (x: unknown, lo: number, hi: number): number | null => (typeof x === 'number' && Number.isFinite(x) ? clamp(Math.round(x), lo, hi) : null);

function sanitizeGame(raw: unknown): Game | null {
  if (!isObject(raw) || !Array.isArray(raw.players) || raw.players.length < 1 || raw.players.length > MAX_PLAYERS) return null;
  const players: Player[] = [];
  for (const p of raw.players) {
    if (!isObject(p) || typeof p.name !== 'string') return null;
    const life = whole(p.life, -LIFE_LIMIT, LIFE_LIMIT);
    if (life == null) return null;
    players.push({
      name: p.name.trim().slice(0, MAX_NAME) || `Player ${players.length + 1}`,
      life,
      poison: whole(p.poison, 0, COUNTER_LIMIT) ?? 0,
      color: seatColor(p.color, players.length),
      partners: p.partners === true,
      cmdr: {},
      ...looks(p.art, p.accent),
    });
  }
  // Commander damage can only come from another seat, and from a partner only if that seat has one.
  raw.players.forEach((p, seat) => {
    const cmdr = isObject(p) && isObject(p.cmdr) ? p.cmdr : {};
    for (const [k, v] of Object.entries(cmdr)) {
      const m = /^([0-5]):([01])$/.exec(k);
      const n = whole(v, 0, COUNTER_LIMIT);
      if (!m || n == null || n === 0) continue;
      const from = Number(m[1]);
      if (from === seat || !players[from] || (m[2] === '1' && !players[from].partners)) continue;
      players[seat].cmdr[k] = n;
    }
  });
  const game: Game = { startingLife: whole(raw.startingLife, 1, 999) ?? DEFAULT_LIFE, players, history: [], first: typeof raw.first === 'number' && Number.isInteger(raw.first) && raw.first >= 0 && raw.first < players.length ? raw.first : null };
  if (Array.isArray(raw.history)) {
    for (const c of raw.history) {
      const t = isObject(c) && isObject(c.target) ? c.target : null;
      if (!t || !isObject(c)) continue;
      const target: Target | null = t.kind === 'life' || t.kind === 'poison' ? { kind: t.kind } : t.kind === 'cmdr' && typeof t.from === 'number' && (t.slot === 0 || t.slot === 1) ? { kind: 'cmdr', from: t.from, slot: t.slot } : null;
      const seat = whole(c.seat, 0, MAX_PLAYERS);
      if (!target || seat == null || typeof c.before !== 'number' || !exists(game, seat, target)) continue;
      const [lo, hi] = range(target);
      const before = whole(c.before, lo, hi);
      if (before != null) game.history.push({ seat, target, before });
    }
    game.history = game.history.slice(-HISTORY_LIMIT);
  }
  return game;
}

/** A player count 1–6 (rounded), else the default. */
function sanitizePlayers(x: unknown): number {
  const n = whole(x, 0, 1000);
  return n != null && n >= 1 && n <= MAX_PLAYERS ? n : DEFAULT_PLAYERS;
}

function sanitizeDefaults(raw: unknown): Defaults {
  const r = isObject(raw) ? raw : {};
  return { players: sanitizePlayers(r.players), startingLife: whole(r.startingLife, 1, 999) ?? DEFAULT_LIFE };
}

function sanitizeSetup(raw: unknown): Setup {
  const r = isObject(raw) ? raw : {};
  const names = Array.isArray(r.names) ? r.names.slice(0, MAX_PLAYERS).map((n) => (typeof n === 'string' ? n.slice(0, MAX_NAME) : '')) : [];
  const colors = Array.isArray(r.colors) ? r.colors.slice(0, MAX_PLAYERS).map((c) => (isSwatch(c) ? c : -1)) : [];
  const setup: Setup = { players: sanitizePlayers(r.players), startingLife: whole(r.startingLife, 1, 999) ?? DEFAULT_LIFE, names, colors };
  if (Array.isArray(r.arts)) setup.arts = r.arts.slice(0, MAX_PLAYERS).map(sanitizeArt);
  if (Array.isArray(r.accents)) setup.accents = r.accents.slice(0, MAX_PLAYERS).map(sanitizeAccent);
  return setup;
}

export interface LifeLoad {
  store: LifeStore;
  /** False when storage is missing or blocked: the game works but won't survive closing the app. */
  persistent: boolean;
  /** A newer version saved something here; it was left alone and must not be overwritten until a new game starts. */
  future: boolean;
}

/** Reads the saved game. Bad data is dropped or clamped, never thrown on. */
export function loadLife(storage: Storage | null): LifeLoad {
  const fresh = (persistent: boolean, future = false): LifeLoad => ({ store: emptyLife(), persistent, future });
  if (!storage) return fresh(false);
  let raw: string | null;
  try {
    raw = storage.getItem(LIFE_KEY);
  } catch {
    return fresh(false);
  }
  if (raw == null) return fresh(true);

  let data: unknown;
  try {
    data = JSON.parse(raw);
    if (!isObject(data)) throw new Error('not an object');
  } catch {
    try {
      storage.setItem(`${LIFE_KEY}:backup`, raw);
    } catch {
      // Nothing more we can do; start fresh.
    }
    return fresh(true);
  }
  if (typeof data.version === 'number' && data.version > 1) return fresh(true, true);
  return { store: { version: 1, game: sanitizeGame(data.game), setup: sanitizeSetup(data.setup), defaults: sanitizeDefaults(data.defaults) }, persistent: true, future: false };
}

/** Saves the game; returns false when storage is missing, blocked or full. */
export function saveLife(storage: Storage | null, store: LifeStore): boolean {
  if (!storage) return false;
  try {
    storage.setItem(LIFE_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}
