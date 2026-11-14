import { describe, expect, it } from 'vitest';
import { ScryfallError } from '../../src/scryfall/client';
import { searchProblem } from '../../src/ui/artPicker';

describe('searchProblem', () => {
  it('puts a plain Error (a query too long to send) on the form, with its own message', () => {
    expect(searchProblem(new Error('This search is too long (1010 of 1000 characters). Shorten the text or drop a filter.'))).toEqual({
      form: true,
      message: 'This search is too long (1010 of 1000 characters). Shorten the text or drop a filter.',
    });
  });

  it('puts a 400 from Scryfall on the form, with what Scryfall said', () => {
    const p = searchProblem(new ScryfallError(400, 'Scryfall 400: Your search contains unclosed parentheses.'));
    expect(p.form).toBe(true);
    expect(p.message).toContain('unclosed parentheses');
  });

  it('keeps every other failure off the form: unreachable, rate limited, server errors, and anything that is not an Error', () => {
    for (const e of [new ScryfallError(0, "Couldn't reach Scryfall: x"), new ScryfallError(429, 'Scryfall 429: slow down'), new ScryfallError(500, 'Scryfall 500: boom'), 'oops', null]) {
      const p = searchProblem(e);
      expect(p.form, String(e)).toBe(false);
      expect(p.message).toBe("Couldn't reach Scryfall. Check your connection and try again.");
    }
  });
});
