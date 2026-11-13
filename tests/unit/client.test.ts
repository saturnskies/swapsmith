import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import notFound from '../fixtures/scryfall-404-named.json';
import { createClient, idbCache, memoryCache, ScryfallError } from '../../src/scryfall/client';

type Call = { url: string; init?: RequestInit };

function fakeFetch(responses: Array<() => Response>) {
  const calls: Call[] = [];
  let i = 0;
  const fn = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const make = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return make();
  };
  return { fn: fn as typeof fetch, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** A fake clock: sleep advances time instantly and records each wait. */
function fakeClock(start = 1_000_000) {
  let t = start;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => { sleeps.push(ms); t += ms; },
    advance: (ms: number) => { t += ms; },
    sleeps,
  };
}

describe('Scryfall client', () => {
  it('spaces requests at least spacingMs apart', async () => {
    const clock = fakeClock();
    const f = fakeFetch([json({ object: 'card', name: 'A' })]);
    const client = createClient({ fetch: f.fn, cache: memoryCache(), now: clock.now, sleep: clock.sleep, spacingMs: 100 });

    await Promise.all([client.get('/cards/a1'), client.get('/cards/b2')]);

    expect(f.calls).toHaveLength(2);
    expect(clock.sleeps).toEqual([100]);
  });

  it('spaces searches, name lookups and collection lookups at least 500 ms apart', async () => {
    const clock = fakeClock();
    const f = fakeFetch([json({ object: 'list', data: [] })]);
    const client = createClient({ fetch: f.fn, cache: memoryCache(), now: clock.now, sleep: clock.sleep, spacingMs: 100 });

    await Promise.all([client.get('/cards/search?q=a'), client.get('/cards/named?fuzzy=b'), client.post('/cards/collection', { identifiers: [] }), client.get('/cards/abc')]);

    // search → named waits 500; named → collection waits 500; collection → /cards/abc only 100.
    expect(clock.sleeps).toEqual([500, 500, 100]);
  });

  it('starts the next request without waiting for the previous reply', async () => {
    const clock = fakeClock();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const started: string[] = [];
    const slowFetch = (async (url: string | URL | Request) => {
      started.push(String(url));
      if (started.length === 1) await gate; // the first reply is slow
      return json({ ok: true })();
    }) as typeof fetch;
    const client = createClient({ fetch: slowFetch, cache: memoryCache(), now: clock.now, sleep: clock.sleep, spacingMs: 100 });

    const first = client.get('/slow');
    const second = client.get('/fast');
    await expect(second).resolves.toEqual({ ok: true });
    expect(started).toHaveLength(2);
    release();
    await first;
  });

  it('retries a request that fails at the network level, then succeeds', async () => {
    const clock = fakeClock();
    let calls = 0;
    const flaky = (async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('Failed to fetch');
      return json({ ok: true })();
    }) as typeof fetch;
    const client = createClient({ fetch: flaky, cache: memoryCache(), now: clock.now, sleep: clock.sleep });

    await expect(client.get('/x')).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
    expect(clock.sleeps).toContain(1000);
  });

  it('gives up after maxRetries network failures with a ScryfallError of status 0', async () => {
    const clock = fakeClock();
    let calls = 0;
    const down = (async () => { calls += 1; throw new TypeError('Failed to fetch'); }) as typeof fetch;
    const client = createClient({ fetch: down, cache: memoryCache(), now: clock.now, sleep: clock.sleep, maxRetries: 2 });

    await expect(client.get('/x')).rejects.toMatchObject({ name: 'ScryfallError', status: 0 });
    expect(calls).toBe(3);
  });

  it('gives up on a request that never answers, and retries it', async () => {
    let calls = 0;
    const hanging = ((_url: string, init?: RequestInit) => {
      calls += 1;
      if (calls === 1) {
        // Never answers; only the client's timeout (an abort) ends it.
        return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      }
      return Promise.resolve(json({ ok: true })());
    }) as typeof fetch;
    const client = createClient({ fetch: hanging, cache: memoryCache(), sleep: async () => {}, spacingMs: 0, heavySpacingMs: 0, timeoutMs: 30 });

    await expect(client.get('/x')).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('keeps at most maxInFlight requests open at once', async () => {
    const clock = fakeClock();
    let open = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const slow = (async () => {
      open += 1;
      peak = Math.max(peak, open);
      await new Promise<void>((r) => releases.push(r));
      open -= 1;
      return json({ ok: true })();
    }) as typeof fetch;
    const client = createClient({ fetch: slow, cache: memoryCache(), now: clock.now, sleep: clock.sleep, maxInFlight: 2 });

    const all = Promise.all([1, 2, 3, 4, 5].map((i) => client.get(`/r${i}`)));
    for (let i = 0; i < 5; i += 1) {
      await new Promise((r) => setTimeout(r, 0));
      releases.shift()?.();
    }
    await new Promise((r) => setTimeout(r, 0));
    while (releases.length) releases.shift()!();
    await all;
    expect(peak).toBe(2);
  });

  it('sends requests to api.scryfall.com with an Accept header', async () => {
    const clock = fakeClock();
    const f = fakeFetch([json({ ok: true })]);
    const client = createClient({ fetch: f.fn, cache: memoryCache(), now: clock.now, sleep: clock.sleep });

    await client.get('/cards/autocomplete?q=edgar');

    expect(f.calls[0].url).toBe('https://api.scryfall.com/cards/autocomplete?q=edgar');
    expect(new Headers(f.calls[0].init?.headers).get('accept')).toBe('application/json');
  });

  it('retries after a 429, honoring Retry-After', async () => {
    const clock = fakeClock();
    const f = fakeFetch([json({ object: 'error' }, 429, { 'retry-after': '2' }), json({ name: 'Sol Ring' })]);
    const client = createClient({ fetch: f.fn, cache: memoryCache(), now: clock.now, sleep: clock.sleep });

    const body = await client.get<{ name: string }>('/cards/named?exact=Sol+Ring');

    expect(body.name).toBe('Sol Ring');
    expect(f.calls).toHaveLength(2);
    expect(clock.sleeps).toContain(2000);
  });

  it('gives up after maxRetries 429s with a ScryfallError', async () => {
    const clock = fakeClock();
    const f = fakeFetch([json({ object: 'error', details: 'slow down' }, 429)]);
    const client = createClient({ fetch: f.fn, cache: memoryCache(), now: clock.now, sleep: clock.sleep, maxRetries: 2 });

    await expect(client.get('/cards/search?q=x')).rejects.toMatchObject({ status: 429 });
    expect(f.calls).toHaveLength(3);
  });

  it('throws a ScryfallError with Scryfall details on other errors, without retrying', async () => {
    const clock = fakeClock();
    // Real reply captured from api.scryfall.com on 2026-11-02 (tests/fixtures/scryfall-404-named.json).
    const f = fakeFetch([json(notFound, 404)]);
    const client = createClient({ fetch: f.fn, cache: memoryCache(), now: clock.now, sleep: clock.sleep });

    const err = (await client.get('/cards/named?exact=Calastria+Highborn').catch((e: unknown) => e)) as ScryfallError;

    expect(err).toBeInstanceOf(ScryfallError);
    expect(err.status).toBe(404);
    expect(err.message).toContain(notFound.details);
    expect(f.calls).toHaveLength(1);
  });

  it('serves a repeat request from the cache within the TTL', async () => {
    const clock = fakeClock();
    const f = fakeFetch([json({ name: 'Edgar Markov' })]);
    const client = createClient({ fetch: f.fn, cache: memoryCache(), now: clock.now, sleep: clock.sleep, ttlMs: 1000 });

    await client.get('/cards/named?exact=Edgar+Markov');
    clock.advance(999);
    const again = await client.get<{ name: string }>('/cards/named?exact=Edgar+Markov');

    expect(again.name).toBe('Edgar Markov');
    expect(f.calls).toHaveLength(1);
  });

  it('fetches again once the cached entry is older than the TTL', async () => {
    const clock = fakeClock();
    const f = fakeFetch([json({ v: 1 }), json({ v: 2 })]);
    const client = createClient({ fetch: f.fn, cache: memoryCache(), now: clock.now, sleep: clock.sleep, ttlMs: 1000 });

    await client.get('/x');
    clock.advance(1001);
    const fresh = await client.get<{ v: number }>('/x');

    expect(fresh.v).toBe(2);
    expect(f.calls).toHaveLength(2);
  });

  it('caches POST requests by body, so different bodies are fetched separately', async () => {
    const clock = fakeClock();
    const f = fakeFetch([json({ n: 1 }), json({ n: 2 })]);
    const client = createClient({ fetch: f.fn, cache: memoryCache(), now: clock.now, sleep: clock.sleep });

    await client.post('/cards/collection', { identifiers: [{ name: 'A' }] });
    await client.post('/cards/collection', { identifiers: [{ name: 'A' }] });
    await client.post('/cards/collection', { identifiers: [{ name: 'B' }] });

    expect(f.calls).toHaveLength(2);
    expect(f.calls[0].init?.method).toBe('POST');
  });

  it('keeps working when the cache throws', async () => {
    const clock = fakeClock();
    const f = fakeFetch([json({ ok: true })]);
    const broken = { get: async () => { throw new Error('blocked'); }, set: async () => { throw new Error('blocked'); } };
    const client = createClient({ fetch: f.fn, cache: broken, now: clock.now, sleep: clock.sleep });

    await expect(client.get('/x')).resolves.toEqual({ ok: true });
  });

  it('does not cache error replies', async () => {
    const clock = fakeClock();
    const f = fakeFetch([json(notFound, 404), json({ name: 'Kalastria Highborn' })]);
    const client = createClient({ fetch: f.fn, cache: memoryCache(), now: clock.now, sleep: clock.sleep });

    await client.get('/x').catch(() => undefined);
    await expect(client.get('/x')).resolves.toEqual({ name: 'Kalastria Highborn' });
  });

  it('can talk to another host: its base URL, its name in errors, and cache keys that never collide with Scryfall', async () => {
    const clock = fakeClock();
    const cache = memoryCache();
    const f = fakeFetch([json({ from: 'scryfall' }), json({ from: 'edhrec' }), () => new Response('', { status: 403, statusText: 'Forbidden' })]);
    const scryfall = createClient({ fetch: f.fn, cache, now: clock.now, sleep: clock.sleep });
    const edhrec = createClient({ fetch: f.fn, cache, now: clock.now, sleep: clock.sleep, base: 'https://json.edhrec.com', service: 'EDHREC' });

    await scryfall.get('/x');
    await expect(edhrec.get('/x')).resolves.toEqual({ from: 'edhrec' });
    expect(f.calls[1].url).toBe('https://json.edhrec.com/x');
    await expect(edhrec.get('/missing')).rejects.toMatchObject({ status: 403, message: 'EDHREC 403: Forbidden' });
  });

  it('names the other host when it cannot be reached', async () => {
    const clock = fakeClock();
    const f = fakeFetch([() => { throw new TypeError('Failed to fetch'); }]);
    const client = createClient({ fetch: f.fn, cache: memoryCache(), now: clock.now, sleep: clock.sleep, maxRetries: 0, base: 'https://json.edhrec.com', service: 'EDHREC' });

    await expect(client.get('/x')).rejects.toMatchObject({ status: 0, message: "Couldn't reach EDHREC: Failed to fetch" });
  });

  it('reports a non-JSON error body by HTTP status', async () => {
    const clock = fakeClock();
    const f = fakeFetch([() => new Response('<html>Bad gateway</html>', { status: 502, statusText: 'Bad Gateway' })]);
    const client = createClient({ fetch: f.fn, cache: memoryCache(), now: clock.now, sleep: clock.sleep });

    await expect(client.get('/x')).rejects.toMatchObject({ status: 502, message: 'Scryfall 502: Bad Gateway' });
  });
});

describe('sharing a request between callers', () => {
  it('sends one request when the same thing is asked for twice at once, and both callers get the reply', async () => {
    const clock = fakeClock();
    const f = fakeFetch([json({ name: 'Sol Ring' })]);
    const client = createClient({ fetch: f.fn, cache: memoryCache(), now: clock.now, sleep: clock.sleep });

    const [a, b] = await Promise.all([client.get('/cards/named?exact=Sol+Ring'), client.get('/cards/named?exact=Sol+Ring')]);

    expect(a).toEqual({ name: 'Sol Ring' });
    expect(b).toEqual({ name: 'Sol Ring' });
    expect(f.calls).toHaveLength(1);
  });

  it('does not share between different requests, or between POSTs with different bodies', async () => {
    const clock = fakeClock();
    const f = fakeFetch([json({ n: 1 }), json({ n: 2 }), json({ n: 3 }), json({ n: 4 })]);
    const client = createClient({ fetch: f.fn, cache: memoryCache(), now: clock.now, sleep: clock.sleep });

    await Promise.all([client.get('/a'), client.get('/b'), client.post('/c', { x: 1 }), client.post('/c', { x: 2 })]);

    expect(f.calls).toHaveLength(4);
  });

  it('shares a failure too, and asks again on the next call', async () => {
    const clock = fakeClock();
    const f = fakeFetch([json(notFound, 404), json({ name: 'Kalastria Highborn' })]);
    const client = createClient({ fetch: f.fn, cache: memoryCache(), now: clock.now, sleep: clock.sleep });

    const both = await Promise.allSettled([client.get('/x'), client.get('/x')]);
    expect(both.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(f.calls).toHaveLength(1);

    await expect(client.get('/x')).resolves.toEqual({ name: 'Kalastria Highborn' });
    expect(f.calls).toHaveLength(2);
  });
});

describe('saved replies when the host cannot be reached', () => {
  const HOUR = 60 * 60 * 1000;
  const down = () => { throw new TypeError('Failed to fetch'); };
  /** A client whose first request succeeds and whose later ones get `then`. */
  function setup(then: () => Response, opts: { offline?: boolean } = {}) {
    const clock = fakeClock();
    const f = fakeFetch([json({ v: 'saved' }), then]);
    const states: string[] = [];
    const client = createClient({ fetch: f.fn, cache: memoryCache(), now: clock.now, sleep: clock.sleep, onNetwork: (s) => states.push(s), offline: () => !!opts.offline && f.calls.length > 0 });
    return { clock, f, states, client };
  }

  it('uses a saved reply past its TTL when the network is down, after the usual retries, and says so', async () => {
    const { clock, f, states, client } = setup(down);
    await client.get('/x');
    clock.advance(25 * HOUR);

    await expect(client.get('/x')).resolves.toEqual({ v: 'saved' });
    expect(f.calls).toHaveLength(1 + 4); // the first request, then one try and three retries
    expect(states).toEqual(['live', 'saved']);
  });

  it('uses the saved reply at once, without trying the network, when the device says it is offline', async () => {
    const { clock, f, states, client } = setup(down, { offline: true });
    await client.get('/x');
    clock.advance(25 * HOUR);

    await expect(client.get('/x')).resolves.toEqual({ v: 'saved' });
    expect(f.calls).toHaveLength(1);
    expect(clock.sleeps).toEqual([]);
    expect(states).toEqual(['live', 'saved']);
  });

  it('still asks the network when offline is reported but nothing is saved, and fails as before', async () => {
    const clock = fakeClock();
    const f = fakeFetch([down]);
    const client = createClient({ fetch: f.fn, cache: memoryCache(), now: clock.now, sleep: clock.sleep, offline: () => true, maxRetries: 0 });
    await expect(client.get('/x')).rejects.toMatchObject({ status: 0 });
  });

  it('uses a saved reply when the host answers with a server error or keeps rate-limiting', async () => {
    for (const status of [503, 429]) {
      const { clock, states, client } = setup(json({ details: 'no' }, status));
      await client.get('/x');
      clock.advance(25 * HOUR);
      await expect(client.get('/x')).resolves.toEqual({ v: 'saved' });
      expect(states.at(-1)).toBe('saved');
    }
  });

  it('does not put a saved reply in place of a real answer such as "not found"', async () => {
    const { clock, client } = setup(json(notFound, 404));
    await client.get('/x');
    clock.advance(25 * HOUR);
    await expect(client.get('/x')).rejects.toMatchObject({ status: 404 });
  });

  it('never uses a saved reply older than a week', async () => {
    const { clock, client } = setup(down);
    await client.get('/x');
    clock.advance(8 * 24 * HOUR);
    await expect(client.get('/x')).rejects.toMatchObject({ status: 0 });
  });

  it('reports live again once the host answers, and saves the fresh reply', async () => {
    const clock = fakeClock();
    const f = fakeFetch([json({ v: 1 }), down, down, down, down, json({ v: 2 })]);
    const states: string[] = [];
    const client = createClient({ fetch: f.fn, cache: memoryCache(), now: clock.now, sleep: clock.sleep, onNetwork: (s) => states.push(s) });
    await client.get('/x');
    clock.advance(25 * HOUR);
    await client.get('/x');
    await expect(client.get('/x')).resolves.toEqual({ v: 2 });
    expect(states).toEqual(['live', 'saved', 'live']);
  });
});

describe('deleting old saved replies', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('deletes replies saved more than a week ago after the first fresh reply of a session, and keeps newer ones', async () => {
    const clock = fakeClock(100 * DAY);
    const cache = memoryCache();
    await cache.set('GET /ancient', { t: clock.now() - 8 * DAY, body: 1 });
    await cache.set('GET /recent', { t: clock.now() - 6 * DAY, body: 2 });
    const f = fakeFetch([json({ ok: true })]);
    const client = createClient({ fetch: f.fn, cache, now: clock.now, sleep: clock.sleep });

    await client.get('/x');
    await new Promise((r) => setTimeout(r, 0));

    expect(await cache.get('GET /ancient')).toBeUndefined();
    expect(await cache.get('GET /recent')).toEqual({ t: clock.now() - 6 * DAY, body: 2 });
    expect(await cache.get('GET /x')).toBeDefined();
  });

  it('works with a cache that cannot delete, and when deleting fails', async () => {
    const clock = fakeClock();
    const plain = memoryCache();
    const noPrune = { get: plain.get, set: plain.set };
    const failing = { ...plain, prune: async () => { throw new Error('blocked'); } };
    for (const cache of [noPrune, failing]) {
      const client = createClient({ fetch: fakeFetch([json({ ok: true })]).fn, cache, now: clock.now, sleep: clock.sleep });
      await expect(client.get('/x')).resolves.toEqual({ ok: true });
    }
  });
});

describe.runIf(process.env.SCRYFALL_LIVE === '1')('live Scryfall (SCRYFALL_LIVE=1)', () => {
  it('fetches a real card and a real 404', async () => {
    // Scryfall rejects Node's default User-Agent; browsers send their own, which it accepts.
    const withUa: typeof fetch = (input, init) =>
      fetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), 'User-Agent': 'Swapsmith-tests/0.1' } });
    const client = createClient({ cache: memoryCache(), fetch: withUa });
    const card = await client.get<{ name: string; prices: Record<string, string | null> }>('/cards/named?exact=Sol+Ring');
    expect(card.name).toBe('Sol Ring');
    expect(card.prices).toHaveProperty('usd');
    await expect(client.get('/cards/named?exact=Calastria+Highborn')).rejects.toMatchObject({ status: 404 });
  });
});

describe('idbCache', () => {
  it('round-trips entries through IndexedDB', async () => {
    const cache = idbCache('swapsmith-test');
    await cache.set('k', { t: 5, body: { a: 1 } });

    expect(await cache.get('k')).toEqual({ t: 5, body: { a: 1 } });
    expect(await cache.get('missing')).toBeUndefined();
  });

  it('deletes entries saved before a cutoff and keeps the rest', async () => {
    const cache = idbCache('swapsmith-test-prune');
    await cache.set('old', { t: 10, body: 'old' });
    await cache.set('edge', { t: 20, body: 'edge' });
    await cache.set('new', { t: 30, body: 'new' });

    await cache.prune!(20);

    expect(await cache.get('old')).toBeUndefined();
    expect(await cache.get('edge')).toEqual({ t: 20, body: 'edge' });
    expect(await cache.get('new')).toEqual({ t: 30, body: 'new' });
  });

  it('drops what the first version of the cache saved, which could never be deleted', async () => {
    // Version 1: the same store, no index, megabytes of printings per deck.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('swapsmith-test-v1', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('responses');
      req.onsuccess = () => {
        const t = req.result.transaction('responses', 'readwrite');
        t.objectStore('responses').put({ t: 1, body: 'legacy' }, 'GET /legacy');
        t.oncomplete = () => (req.result.close(), resolve());
      };
      req.onerror = () => reject(req.error);
    });

    const cache = idbCache('swapsmith-test-v1');
    expect(await cache.get('GET /legacy')).toBeUndefined();
    await cache.set('k', { t: 5, body: 1 });
    expect(await cache.get('k')).toEqual({ t: 5, body: 1 });
  });
});
