import { describe, expect, it } from 'vitest';
import { backupFileName, BackupError, makeBackup, mergeBackup, parseBackup, readBackupProfiles } from '../../src/lib/backup';
import { cleanDeckName, type Deck } from '../../src/lib/deck';
import { emptyStore, type Store } from '../../src/lib/storage';
import { backTarget } from '../../src/lib/nav';
import type { Profile } from '../../src/lib/profiles';

const deck = (id: string, name: string, updatedAt: string): Deck => ({
  id,
  name,
  format: 'commander',
  commander: { oracleId: `o-${id}`, name: 'Edgar Markov' },
  cards: [{ card: { oracleId: 'o-sol', name: 'Sol Ring' }, qty: 1 }],
  updatedAt,
});
const store = (over: Partial<Store>): Store => ({ ...emptyStore(), ...over });

describe('backup round trip', () => {
  it('parses what makeBackup wrote', () => {
    const s = store({ decks: [{ ...deck('a', 'Edgar', '2026-01-01T00:00:00Z'), owned: ['o-sol'], unownedBasics: ['o-swamp'] }], prefs: { view: 'grid' } });
    expect(parseBackup(makeBackup(s))).toEqual(s);
  });

  it('names the file by date', () => {
    expect(backupFileName(new Date('2026-11-02T10:00:00Z'))).toBe('swapsmith-backup-2026-11-02.json');
  });

  it.each([
    ['not json', 'hello'],
    ['empty', ''],
    ['json null', 'null'],
    ['an array', '[]'],
    ['a different app', JSON.stringify({ app: 'other', backup: 1, store: {} })],
    ['a newer format', JSON.stringify({ app: 'swapsmith', backup: 2, store: {} })],
    ['no store', JSON.stringify({ app: 'swapsmith', backup: 1 })],
  ])('rejects %s', (_, text) => {
    expect(() => parseBackup(text)).toThrow(BackupError);
  });

  it('drops damaged decks and keeps the good ones', () => {
    const good = deck('a', 'Edgar', '2026-01-01T00:00:00Z');
    const text = JSON.stringify({ app: 'swapsmith', backup: 1, store: { decks: [good, { id: 'x' }, 7], owned: ['o-sol', 3] } });
    const out = parseBackup(text);
    // A backup made before ownership moved into each deck still restores: its shared list lands in the decks.
    expect(out.decks).toEqual([{ ...good, owned: ['o-sol'], unownedBasics: [] }]);
    expect(out).not.toHaveProperty('owned');
  });

  it('restores an old-format backup with each deck keeping only its own ticks', () => {
    const a = deck('a', 'A', '2026-01-01T00:00:00Z');
    const b = { ...deck('b', 'B', '2026-01-01T00:00:00Z'), cards: [{ card: { oracleId: 'o-signet', name: 'Arcane Signet' }, qty: 1 }] };
    const old = JSON.stringify({ app: 'swapsmith', backup: 1, store: { version: 1, decks: [a, b], owned: ['o-sol', 'o-signet'], unownedBasics: [] } });
    const out = parseBackup(old);
    expect(out.decks.find((d) => d.id === 'a')!.owned).toEqual(['o-sol']);
    expect(out.decks.find((d) => d.id === 'b')!.owned).toEqual(['o-signet']);
  });
});

describe('backup profiles', () => {
  const profiles: Profile[] = [
    { id: 'p1', name: 'Ann', accent: '#123456', art: { id: 'i', cardId: 'c', name: 'Edgar Markov', artist: 'Eric Deschamps', url: 'https://cards.scryfall.io/art_crop/front/a/b/ab.jpg?1' } },
    { id: 'p2', name: 'Bo' },
  ];
  const file = (extra: Record<string, unknown>) => JSON.stringify({ app: 'swapsmith', backup: 1, store: { decks: [] }, ...extra });

  it('makeBackup then readBackupProfiles round-trips', () => {
    expect(readBackupProfiles(makeBackup(store({}), new Date(), profiles))).toEqual(profiles);
  });

  it('writes no profiles field when there are none, and the rest of the file is unchanged', () => {
    const now = new Date('2026-11-14T10:00:00Z');
    const plain = makeBackup(store({}), now);
    expect(JSON.parse(plain)).not.toHaveProperty('profiles');
    expect(makeBackup(store({}), now, [])).toBe(plain);
    const withProfiles = JSON.parse(makeBackup(store({}), now, profiles));
    expect(withProfiles).toMatchObject({ app: 'swapsmith', backup: 1, exportedAt: now.toISOString() });
    const { profiles: _p, ...rest } = withProfiles;
    expect(rest).toEqual(JSON.parse(plain));
  });

  it.each([
    ['a string', file({ profiles: 'x' })],
    ['an object', file({ profiles: { id: 'a', name: 'b' } })],
    ['null', file({ profiles: null })],
    ['no field', file({})],
  ])('gives [] for profiles that are %s', (_, text) => {
    expect(readBackupProfiles(text)).toEqual([]);
  });

  it('cleans odd entries like the store does', () => {
    const raw = [7, { id: 'a' }, { id: 'b', name: 'x'.repeat(500), accent: 'red' }, { id: 'b', name: 'dup' }, ...Array.from({ length: 100 }, (_, i) => ({ id: `q${i}`, name: 'N' }))];
    const out = readBackupProfiles(file({ profiles: raw }));
    expect(out).toHaveLength(12);
    expect(out[0]).toEqual({ id: 'b', name: 'x'.repeat(24) });
  });

  it.each([
    ['not json', 'not json'],
    ['empty', ''],
    ['json null', 'null'],
    ['an array', '[]'],
    ['a different app', JSON.stringify({ app: 'other', backup: 1, store: {}, profiles })],
    ['a newer format', JSON.stringify({ app: 'swapsmith', backup: 2, store: {}, profiles })],
    ['no store', JSON.stringify({ app: 'swapsmith', backup: 1, profiles })],
  ])('readBackupProfiles throws BackupError for %s, as parseBackup does', (_, text) => {
    expect(() => readBackupProfiles(text)).toThrow(BackupError);
    expect(() => parseBackup(text)).toThrow(BackupError);
  });

  it('parseBackup of a file with profiles returns the same Store as without', () => {
    const s = store({ decks: [{ ...deck('a', 'Edgar', '2026-01-01T00:00:00Z'), owned: ['o-sol'], unownedBasics: [] }], prefs: { view: 'grid' } });
    const now = new Date();
    expect(parseBackup(makeBackup(s, now, profiles))).toEqual(parseBackup(makeBackup(s, now)));
    expect(parseBackup(makeBackup(s, now, profiles))).toEqual(s);
    expect(parseBackup(makeBackup(s, now, profiles))).not.toHaveProperty('profiles');
  });
});

describe('mergeBackup', () => {
  it('adds decks that are only in the backup and keeps the current ones', () => {
    const cur = store({ decks: [deck('a', 'A', '2026-02-01T00:00:00Z')] });
    const bak = store({ decks: [deck('b', 'B', '2026-01-01T00:00:00Z')] });
    const r = mergeBackup(cur, bak);
    expect(r.store.decks.map((d) => d.id)).toEqual(['a', 'b']);
    expect(r).toMatchObject({ added: 1, updated: 0 });
  });

  it('keeps whichever copy of a deck was edited last', () => {
    const cur = store({ decks: [deck('a', 'New name', '2026-03-01T00:00:00Z'), deck('c', 'Old', '2026-01-01T00:00:00Z')] });
    const bak = store({ decks: [deck('a', 'Old name', '2026-02-01T00:00:00Z'), deck('c', 'Newer', '2026-02-01T00:00:00Z')] });
    const r = mergeBackup(cur, bak);
    expect(r.store.decks.find((d) => d.id === 'a')!.name).toBe('New name');
    expect(r.store.decks.find((d) => d.id === 'c')!.name).toBe('Newer');
    expect(r).toMatchObject({ added: 0, updated: 1 });
  });

  it('keeps a deck together with its own ticks: the newer copy wins and nothing is mixed between decks', () => {
    const cur = store({ decks: [{ ...deck('a', 'A', '2026-03-01T00:00:00Z'), owned: ['mine'] }, { ...deck('c', 'C', '2026-01-01T00:00:00Z'), owned: ['old'] }] });
    const bak = store({ decks: [{ ...deck('a', 'A', '2026-02-01T00:00:00Z'), owned: ['theirs'] }, { ...deck('c', 'C', '2026-02-01T00:00:00Z'), owned: ['new'] }] });
    const r = mergeBackup(cur, bak);
    expect(r.store.decks.find((d) => d.id === 'a')!.owned).toEqual(['mine']);
    expect(r.store.decks.find((d) => d.id === 'c')!.owned).toEqual(['new']);
    expect(r.store).not.toHaveProperty('owned');
  });

  it('keeps the current view preference', () => {
    const r = mergeBackup(store({ prefs: { view: 'grid' } }), store({ prefs: { view: 'list' } }));
    expect(r.store.prefs.view).toBe('grid');
  });

  it('does not change the stores it was given', () => {
    const cur = store({ decks: [deck('a', 'A', '2026-02-01T00:00:00Z')] });
    mergeBackup(cur, store({ decks: [deck('b', 'B', '2026-01-01T00:00:00Z')] }));
    expect(cur.decks).toHaveLength(1);
  });
});

describe('cleanDeckName', () => {
  it('trims and collapses spaces', () => expect(cleanDeckName('  Edgar   Vampires ')).toBe('Edgar Vampires'));
  it.each(['', '   ', '\n\t'])('rejects empty input %j', (raw) => expect(cleanDeckName(raw)).toBeNull());
  it('limits the length', () => expect(cleanDeckName('x'.repeat(200))).toHaveLength(80));
  it('keeps text that looks like markup as plain text', () => expect(cleanDeckName('<b>hi</b>')).toBe('<b>hi</b>'));
});

describe('backTarget', () => {
  it('goes home from a deck, a shared deck and the other screens', () => {
    for (const r of ['#/deck/abc', '/deck/abc', '#d=xyz', '/paste', '#/new']) expect(backTarget(r)).toBe('#/');
  });
  it('leaves the app from home', () => {
    for (const r of ['', '#', '/', '#/']) expect(backTarget(r)).toBeNull();
  });
});
