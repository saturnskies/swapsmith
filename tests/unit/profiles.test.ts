import { describe, expect, it } from 'vitest';
import type { ArtRef } from '../../src/lib/art';
import { MAX_NAME, newGame, setAccent, setArt, setName, type Game } from '../../src/lib/life';
import { MAX_PROFILES, addProfile, applyProfile, deleteProfile, mergeProfiles, newProfileId, profileFromSeat, renameProfile, sanitizeProfiles, type Profile } from '../../src/lib/profiles';

const art = (over: Partial<ArtRef> = {}): ArtRef => ({ id: 'illus-1', cardId: 'card-1', name: 'Edgar Markov', artist: 'Eric Deschamps', url: 'https://cards.scryfall.io/art_crop/front/a/b/ab.jpg?1', ...over });
const prof = (id: string, over: Partial<Profile> = {}): Profile => ({ id, name: `Name ${id}`, ...over });
const many = (n: number, prefix = 'p'): Profile[] => Array.from({ length: n }, (_, i) => prof(`${prefix}${i}`));

describe('sanitizeProfiles', () => {
  it('keeps a good profile with art and accent, copied field by field', () => {
    const raw = { id: 'p1', name: 'Ann', art: art(), accent: '#ABCDEF', extra: 'x' };
    const out = sanitizeProfiles([raw]);
    expect(out).toEqual([{ id: 'p1', name: 'Ann', art: art(), accent: '#abcdef' }]);
    expect(out[0].art).not.toBe(raw.art);
  });

  it.each([
    ['undefined', undefined],
    ['a string', 'x'],
    ['an object', { id: 'a', name: 'b' }],
    ['null', null],
  ])('gives [] for %s', (_, x) => expect(sanitizeProfiles(x)).toEqual([]));

  it('drops a non-object, a missing or blank name, a missing or odd id', () => {
    const out = sanitizeProfiles([7, null, 'x', [], { id: 'a' }, { id: 'b', name: '   ' }, { id: 'c', name: 5 }, { name: 'No id' }, { id: 5, name: 'Num id' }, { id: '', name: 'Empty id' }, { id: 'ok', name: 'Fine' }]);
    expect(out).toEqual([{ id: 'ok', name: 'Fine' }]);
  });

  it('trims names and cuts a 10 KB name to 24 characters', () => {
    const out = sanitizeProfiles([{ id: 'a', name: '  Ann  ' }, { id: 'b', name: 'x'.repeat(10_000) }]);
    expect(out[0].name).toBe('Ann');
    expect(out[1].name).toBe('x'.repeat(MAX_NAME));
    expect(MAX_NAME).toBe(24);
  });

  it('drops a non-hex accent but keeps the profile', () => {
    const out = sanitizeProfiles([{ id: 'a', name: 'Ann', accent: 'red' }, { id: 'b', name: 'Bo', accent: '#12345' }]);
    expect(out).toEqual([{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bo' }]);
    expect(out[0]).not.toHaveProperty('accent');
  });

  it('drops art with a bad host or scheme but keeps the profile', () => {
    const out = sanitizeProfiles([{ id: 'a', name: 'Ann', art: art({ url: 'http://cards.scryfall.io/x.jpg' }) }, { id: 'b', name: 'Bo', art: { id: 'x' } }]);
    expect(out).toEqual([{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bo' }]);
    expect(out[0]).not.toHaveProperty('art');
  });

  it('dedupes by id and keeps the first', () => {
    const out = sanitizeProfiles([{ id: 'a', name: 'First' }, { id: 'a', name: 'Second' }, { id: 'b', name: 'Other' }]);
    expect(out).toEqual([{ id: 'a', name: 'First' }, { id: 'b', name: 'Other' }]);
  });

  it('caps 500 entries at 12, keeping the first twelve', () => {
    const raw = Array.from({ length: 500 }, (_, i) => ({ id: `p${i}`, name: `N${i}` }));
    const out = sanitizeProfiles(raw);
    expect(out).toHaveLength(MAX_PROFILES);
    expect(MAX_PROFILES).toBe(12);
    expect(out.map((p) => p.id)).toEqual(raw.slice(0, 12).map((p) => p.id));
  });

  it('does not count dropped or duplicate entries against the cap', () => {
    const raw = [...Array.from({ length: 20 }, () => ({ id: 'same', name: 'Dup' })), ...Array.from({ length: 5 }, () => 7), ...Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, name: 'N' }))];
    expect(sanitizeProfiles(raw)).toHaveLength(12);
  });
});

describe('profileFromSeat', () => {
  const player = (over: Record<string, unknown> = {}) => ({ ...newGame({ players: 2, startingLife: 40, names: [], colors: [] }).players[1], ...over });

  it('is null for an empty name, a blank name and the default Player 2', () => {
    expect(profileFromSeat(player({ name: '' }), 'p1')).toBeNull();
    expect(profileFromSeat(player({ name: '   ' }), 'p1')).toBeNull();
    expect(profileFromSeat(player(), 'p1')).toBeNull();
    expect(player().name).toBe('Player 2');
  });

  it('copies name, art and accent', () => {
    expect(profileFromSeat(player({ name: ' Ann ', art: art(), accent: '#123456' }), 'p1')).toEqual({ id: 'p1', name: 'Ann', art: art(), accent: '#123456' });
  });

  it('leaves out art and accent the seat lacks', () => {
    const p = profileFromSeat(player({ name: 'Ann' }), 'p1')!;
    expect(p).toEqual({ id: 'p1', name: 'Ann' });
    expect(p).not.toHaveProperty('art');
    expect(p).not.toHaveProperty('accent');
  });

  it('does not share the art object with the seat', () => {
    const a = art();
    expect(profileFromSeat(player({ name: 'Ann', art: a }), 'p1')!.art).not.toBe(a);
  });
});

describe('addProfile, renameProfile, deleteProfile', () => {
  it('adds to the end and returns a new list', () => {
    const list = many(2);
    const out = addProfile(list, prof('new'))!;
    expect(out.map((p) => p.id)).toEqual(['p0', 'p1', 'new']);
    expect(list).toHaveLength(2);
  });

  it('returns null at 12 and for a taken id', () => {
    expect(addProfile(many(12), prof('new'))).toBeNull();
    expect(addProfile(many(11), prof('new'))).toHaveLength(12);
    expect(addProfile(many(3), prof('p1'))).toBeNull();
  });

  it('renames one profile, trimmed and cut to 24, and leaves the others', () => {
    const list = many(3);
    const out = renameProfile(list, 'p1', `  ${'y'.repeat(40)}  `);
    expect(out[1].name).toBe('y'.repeat(24));
    expect(out[0]).toBe(list[0]);
    expect(out[2]).toBe(list[2]);
    expect(list[1].name).toBe('Name p1');
  });

  it('keeps the old name when the new one is blank, and ignores an unknown id', () => {
    const list = many(2);
    expect(renameProfile(list, 'p1', '   ')).toEqual(list);
    expect(renameProfile(list, 'nope', 'X')).toEqual(list);
  });

  it('deletes by id and ignores an unknown id', () => {
    const list = many(3);
    expect(deleteProfile(list, 'p1').map((p) => p.id)).toEqual(['p0', 'p2']);
    expect(deleteProfile(list, 'nope')).toEqual(list);
    expect(list).toHaveLength(3);
  });
});

describe('applyProfile', () => {
  const base = (): Game => {
    let g = newGame({ players: 3, startingLife: 40, names: ['A', 'B', 'C'], colors: [] });
    g = setArt(g, 1, art({ id: 'old' }));
    g = setAccent(g, 1, '#111111');
    return g;
  };

  it('copies name, art and accent onto the seat', () => {
    const g = applyProfile(base(), 0, prof('p', { name: 'Ann', art: art(), accent: '#abcdef' }));
    expect(g.players[0]).toMatchObject({ name: 'Ann', art: art(), accent: '#abcdef' });
  });

  it('clears the seat art and accent when the profile has none', () => {
    const g = applyProfile(base(), 1, prof('p', { name: 'Ann' }));
    expect(g.players[1].name).toBe('Ann');
    expect(g.players[1]).not.toHaveProperty('art');
    expect(g.players[1]).not.toHaveProperty('accent');
  });

  it('never changes other seats, life or history', () => {
    const before = base();
    const g = applyProfile(before, 1, prof('p', { name: 'Ann', art: art(), accent: '#abcdef' }));
    expect(g.players[0]).toBe(before.players[0]);
    expect(g.players[2]).toBe(before.players[2]);
    expect(g.players[1].life).toBe(before.players[1].life);
    expect(g.history).toBe(before.history);
    expect(before.players[1].name).toBe('B');
  });

  it('does not share the art object with the profile', () => {
    const p = prof('p', { art: art() });
    expect(applyProfile(base(), 0, p).players[0].art).not.toBe(p.art);
  });

  it('uses the same bounds as the setters: a seat that does not exist changes nothing', () => {
    const before = base();
    expect(applyProfile(before, 9, prof('p', { name: 'Ann' }))).toBe(before);
  });

  it('gives the same result as calling the setters', () => {
    const p = prof('p', { name: 'Ann', art: art(), accent: '#abcdef' });
    let expected = setName(base(), 2, p.name);
    expected = setArt(expected, 2, p.art!);
    expected = setAccent(expected, 2, p.accent!);
    expect(applyProfile(base(), 2, p)).toEqual(expected);
  });
});

describe('mergeProfiles', () => {
  it('keeps the current copy on a shared id and adds new ones after it', () => {
    const current = [prof('a', { name: 'Mine' }), prof('b')];
    const r = mergeProfiles(current, [prof('a', { name: 'Theirs' }), prof('c')]);
    expect(r.profiles.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(r.profiles[0].name).toBe('Mine');
    expect(r).toMatchObject({ added: 1, skipped: 0 });
  });

  it('adds only up to 12 and counts the rest as skipped', () => {
    const r = mergeProfiles(many(10), many(5, 'q'));
    expect(r.profiles).toHaveLength(12);
    expect(r.profiles.map((p) => p.id).slice(10)).toEqual(['q0', 'q1']);
    expect(r).toMatchObject({ added: 2, skipped: 3 });
  });

  it('skips everything when the pod is full, and loses nothing', () => {
    const current = many(12);
    const r = mergeProfiles(current, many(3, 'q'));
    expect(r.profiles).toEqual(current);
    expect(r).toMatchObject({ added: 0, skipped: 3 });
  });

  it('does not count a profile already present as skipped, even when full', () => {
    const r = mergeProfiles(many(12), [prof('p3')]);
    expect(r).toMatchObject({ added: 0, skipped: 0 });
  });

  it('does not change what it was given and handles empty lists', () => {
    const current = many(2);
    mergeProfiles(current, many(2, 'q'));
    expect(current).toHaveLength(2);
    expect(mergeProfiles([], [])).toEqual({ profiles: [], added: 0, skipped: 0 });
  });
});

describe('newProfileId', () => {
  it('is p plus 8 hex characters', () => {
    expect(newProfileId()).toMatch(/^p[0-9a-f]{8}$/);
  });

  it('pads a small draw to 8 characters and uses the injected draw', () => {
    expect(newProfileId(() => 255)).toBe('p000000ff');
    expect(newProfileId(() => 0xffffffff)).toBe('pffffffff');
  });

  it('differs between calls', () => {
    expect(new Set(Array.from({ length: 20 }, () => newProfileId())).size).toBe(20);
  });
});
