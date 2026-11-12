import { describe, expect, it } from 'vitest';
import { THEMES } from '../../src/lib/profile';
import { ScryfallError, type ScryfallClient } from '../../src/scryfall/client';
import { candidatePool, profileSearches } from '../../src/scryfall/suggest';

const profile = { colorIdentity: ['B'], tribe: 'Vampire', themes: THEMES.filter((t) => t.id === 'sacrifice') };
const list = (names: string[]) => ({ object: 'list', data: names.map((n) => ({ oracle_id: `o-${n}`, name: n })) });

describe('candidatePool', () => {
  it('tags each card with the tribe and theme searches and the role searches it turned up in', async () => {
    const client: ScryfallClient = {
      get: async <T,>(path: string) => {
        const q = new URLSearchParams(path.split('?')[1]).get('q')!;
        if (q.includes('t:vampire')) return list(['Blood Artist', 'Cordial Vampire']) as T;
        if (q.includes('o:/sacrifice')) return list(['Blood Artist']) as T;
        if (q.includes('otag:removal')) return list(['Blood Artist', 'Mortify']) as T;
        throw new ScryfallError(404, 'none');
      },
      post: async () => { throw new Error('unused'); },
    };
    const { pool, failed } = await candidatePool(client, profile);
    expect(failed).toEqual([]);
    expect(pool.find((e) => e.card.name === 'Blood Artist')).toMatchObject({ tags: ['Vampire', 'sacrifice'], roles: ['removal'] });
    expect(pool.find((e) => e.card.name === 'Mortify')).toMatchObject({ tags: [], roles: ['removal'] });
  });

  it('keeps the searches that answered when one fails, and says which failed', async () => {
    const client: ScryfallClient = {
      get: async <T,>(path: string) => {
        const q = new URLSearchParams(path.split('?')[1]).get('q')!;
        if (q.includes('otag:ramp')) throw new ScryfallError(0, "Couldn't reach Scryfall");
        if (q.includes('t:vampire')) return list(['Blood Artist']) as T;
        throw new ScryfallError(404, 'none');
      },
      post: async () => { throw new Error('unused'); },
    };
    const { pool, failed } = await candidatePool(client, profile);
    expect(failed).toEqual(['ramp']);
    expect(pool.map((e) => e.card.name)).toEqual(['Blood Artist']);
  });

  it('fails outright only when every search fails', async () => {
    const client: ScryfallClient = { get: async () => { throw new ScryfallError(0, 'offline'); }, post: async () => { throw new Error('unused'); } };
    await expect(candidatePool(client, profile)).rejects.toThrow('offline');
    expect(profileSearches(profile)).toHaveLength(12);
  });

  it('searches the tribe, the themes, and ten roles: the four core ones plus tags checked on Scryfall 2026-11-04', () => {
    const searches = profileSearches(profile);
    expect(searches.filter((s) => s.kind === 'theme').map((s) => s.label)).toEqual(['Vampire', 'sacrifice']);
    expect(searches.filter((s) => s.kind === 'role').map((s) => s.query)).toEqual([
      'otag:ramp', 'otag:card-advantage', 'otag:removal', 'otag:board-wipe',
      'otag:tutor', 'otag:recursion', 'otag:protection', 'otag:counterspell', 'otag:mana-rock', 'otag:sacrifice-outlet',
    ]);
  });
});

describe('deckCardFacts', () => {
  it('never offers a card whose Scryfall data failed to load as a cut or for replacement', async () => {
    const { deckCardFacts } = await import('../../src/scryfall/suggest');
    const facts = deckCardFacts(
      [
        { entry: { card: { oracleId: 'o-ok', name: 'Ok' }, qty: 1 }, isCommander: false, card: { name: 'Ok', edhrec_rank: 10 } as never, typeLine: 'Creature', price: 1, finish: 'nonfoil', url: null, cheapest: null },
        { entry: { card: { oracleId: 'o-gone', name: 'Gone' }, qty: 1 }, isCommander: false, card: null, typeLine: '', price: null, finish: null, url: null, cheapest: null },
        { entry: { card: { oracleId: 'o-fail', name: 'Failed' }, qty: 1 }, isCommander: false, card: { name: 'Failed' } as never, typeLine: 'Creature', price: null, finish: null, url: null, cheapest: null, failed: true },
      ],
      new Map(),
      [],
      { owned: [], unownedBasics: [] },
    );
    expect(facts.map((f) => [f.name, f.keep])).toEqual([['Ok', false], ['Gone', true], ['Failed', true]]);
  });
});
