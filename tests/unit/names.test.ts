import { describe, expect, it } from 'vitest';
import { ScryfallError, type ScryfallClient } from '../../src/scryfall/client';
import { gameChangerCount } from '../../src/scryfall/names';

const fake = (answer: (q: string) => unknown): ScryfallClient & { queries: string[] } => {
  const queries: string[] = [];
  return {
    queries,
    get: async <T,>(path: string) => {
      const q = new URLSearchParams(path.split('?')[1]).get('q')!;
      queries.push(q);
      return answer(q) as T;
    },
    post: async () => { throw new Error('unused'); },
  };
};
const list = (names: string[], extra: Record<string, unknown> = {}) => ({ object: 'list', has_more: false, data: names.map((name) => ({ name, oracle_id: `o-${name}` })), ...extra });
const GAME_CHANGERS = ['Demonic Tutor', 'Smothering Tithe', 'The One Ring'];

describe('gameChangerCount', () => {
  it('counts the deck cards on Scryfall\'s Game Changers list, with one request for the whole list', async () => {
    const client = fake(() => list(GAME_CHANGERS));
    expect(await gameChangerCount(client, ['o-Sol Ring', 'o-Demonic Tutor', 'o-Smothering Tithe'])).toBe(2);
    expect(client.queries).toEqual(['is:gamechanger']);
  });

  it('counts a card once however many copies or entries the deck has, and a double-faced card by its front face', async () => {
    const client = fake(() => ({ object: 'list', has_more: false, data: [{ name: 'A // B', card_faces: [{ oracle_id: 'o-front' }] }, { name: 'C', oracle_id: 'o-c' }] }));
    expect(await gameChangerCount(client, ['o-front', 'o-c', 'o-c'])).toBe(2);
  });

  it('counts zero for a deck with none', async () => {
    const client = fake(() => list(GAME_CHANGERS));
    expect(await gameChangerCount(client, ['o-Sol Ring'])).toBe(0);
  });

  it('gives up (null) when the list cannot be read, rather than guess low', async () => {
    const down = fake(() => { throw new ScryfallError(0, "Couldn't reach Scryfall"); });
    expect(await gameChangerCount(down, ['o-Sol Ring'])).toBeNull();
    // "No Game Changers exist" (404) is not an answer Scryfall should ever give: treat it as unknown too.
    const none = fake(() => { throw new ScryfallError(404, 'none'); });
    expect(await gameChangerCount(none, ['o-Sol Ring'])).toBeNull();
  });

  it('gives up (null) when the reply is only part of the list, or Scryfall ignored the term', async () => {
    expect(await gameChangerCount(fake(() => list(GAME_CHANGERS, { has_more: true })), ['o-Demonic Tutor'])).toBeNull();
    expect(await gameChangerCount(fake(() => list(GAME_CHANGERS, { warnings: ['Invalid expression “is:gamechanger” was ignored.'] })), ['o-Demonic Tutor'])).toBeNull();
  });
});
