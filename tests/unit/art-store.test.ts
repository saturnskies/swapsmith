import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtRef } from '../../src/lib/art';
import { ART_CAPS, MAX_IMAGE_BYTES, createArtStore, isArtUrl, type ArtStoreOptions } from '../../src/ui/artStore';

const URL_OK = 'https://cards.scryfall.io/art_crop/front/a/b/ab.jpg?1';
const ref = (id: string, over: Partial<ArtRef> = {}): ArtRef => ({ id, cardId: `card-${id}`, name: `Card ${id}`, artist: 'Artist', url: `https://cards.scryfall.io/art_crop/front/${id}.jpg?1`, ...over });
const bytes = (n: number) => new Uint8Array(n).fill(7);
const image = (n = 1000, headers: Record<string, string> = {}) => () => new Response(bytes(n), { status: 200, headers: { 'content-type': 'image/jpeg', ...headers } });

let dbCount = 0;

/** A store on a fresh database, a fake clock that ticks once per read, and a fetch that records its calls. */
function setup(reply: () => Response | Promise<Response> = image(), over: ArtStoreOptions = {}) {
  const fetches: Array<{ url: string; init?: RequestInit }> = [];
  const urls = new Map<string, Blob>();
  const revoked: string[] = [];
  let t = 1000;
  const store = createArtStore({
    dbName: `art-test-${dbCount++}`,
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      fetches.push({ url: String(url), init });
      return reply();
    }) as typeof fetch,
    now: () => (t += 10),
    createObjectURL: (b) => {
      const u = `blob:test/${urls.size + revoked.length}`;
      urls.set(u, b);
      return u;
    },
    revokeObjectURL: (u) => void revoked.push(u),
    ...over,
  });
  return { store, fetches, urls, revoked, advance: (ms: number) => void (t += ms) };
}

/** A factory that counts opens and hands each opened connection to `seen`, on top of the (fake) browser IndexedDB. */
function spyFactory(onOpen?: (req: IDBOpenDBRequest, call: number) => void) {
  const conns: IDBDatabase[] = [];
  let opens = 0;
  const factory = {
    open(name: string, version?: number) {
      const call = ++opens;
      const req = indexedDB.open(name, version);
      req.addEventListener('success', () => conns.push(req.result));
      onOpen?.(req, call);
      return req;
    },
  } as unknown as IDBFactory;
  return { factory, conns, opens: () => opens };
}

afterEach(() => vi.restoreAllMocks());

describe('isArtUrl', () => {
  it('accepts only https on cards.scryfall.io, with no credentials or port', () => {
    expect(isArtUrl(URL_OK)).toBe(true);
    for (const bad of ['http://cards.scryfall.io/a.jpg', 'https://example.com/a.jpg', 'https://cards.scryfall.io.evil.test/a.jpg', 'https://evil.test/cards.scryfall.io/a.jpg', 'https://user:pw@cards.scryfall.io/a.jpg', 'https://cards.scryfall.io@evil.test/a.jpg', 'https://cards.scryfall.io:8443/a.jpg', 'https://scryfall.io/a.jpg', 'data:image/jpeg;base64,AAAA', 'blob:https://cards.scryfall.io/x', 'not a url', '']) expect(isArtUrl(bad), bad).toBe(false);
  });
});

describe('artStore.save', () => {
  it('fetches the image (CORS, no cookies, no redirects) and keeps blob, size and time under the artwork id', async () => {
    const { store, fetches, urls } = setup(image(1234));
    expect(await store.save(ref('a'), new Set())).toBe('a');
    expect(fetches).toHaveLength(1);
    expect(fetches[0].url).toBe(ref('a').url);
    expect(fetches[0].init).toMatchObject({ mode: 'cors', credentials: 'omit', redirect: 'error' });
    expect(await store.has('a')).toBe(true);
    await store.url('a');
    const blob = [...urls.values()][0];
    expect(blob.size).toBe(1234);
    expect(blob.type).toBe('image/jpeg');
  });

  it('refuses a non-OK reply, an HTML reply, an empty body, an SVG, a rejected fetch and a cut-off body, and keeps nothing', async () => {
    const cases: Array<[string, () => Response | Promise<Response>]> = [
      ['404', () => new Response('nope', { status: 404, headers: { 'content-type': 'image/jpeg' } })],
      ['500', () => new Response('nope', { status: 500 })],
      ['200 with HTML', () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })],
      ['no content type', () => new Response(bytes(10), { status: 200 })],
      ['empty body', () => new Response(new Uint8Array(0), { status: 200, headers: { 'content-type': 'image/jpeg' } })],
      ['svg', () => new Response('<svg/>', { status: 200, headers: { 'content-type': 'image/svg+xml' } })],
      ['cut off', () => new Response(bytes(500), { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': '5000' } })],
      ['rejects', () => Promise.reject(new TypeError('Failed to fetch'))],
      ['body read fails', () => new Response(new ReadableStream({ start: (c) => c.error(new Error('reset')) }), { status: 200, headers: { 'content-type': 'image/jpeg' } })],
    ];
    for (const [label, reply] of cases) {
      const { store } = setup(reply);
      expect(await store.save(ref('x'), new Set()), label).toBeNull();
      expect(await store.has('x'), label).toBe(false);
    }
  });

  it('refuses anything over 600 KB, announced or not, and keeps exactly 600 KB', async () => {
    const big = setup(image(MAX_IMAGE_BYTES + 1));
    expect(await big.store.save(ref('big'), new Set())).toBeNull();
    expect(await big.store.has('big')).toBe(false);

    const announced = setup(() => new Response(bytes(10), { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': String(MAX_IMAGE_BYTES + 1) } }));
    expect(await announced.store.save(ref('big'), new Set())).toBeNull();

    const exact = setup(image(MAX_IMAGE_BYTES));
    expect(await exact.store.save(ref('ok'), new Set())).toBe('ok');
  });

  it('refuses a url that is not https on cards.scryfall.io before fetching anything', async () => {
    const { store, fetches } = setup();
    for (const url of ['http://cards.scryfall.io/a.jpg', 'https://example.com/a.jpg', 'https://cards.scryfall.io.evil.test/a.jpg', 'https://user:pw@cards.scryfall.io/a.jpg', 'https://cards.scryfall.io@evil.test/a.jpg']) {
      expect(await store.save(ref('evil', { url }), new Set()), url).toBeNull();
    }
    expect(fetches).toEqual([]);
    expect(await store.has('evil')).toBe(false);
  });

  it('saved twice at once is one fetch and one row; saved again later is no fetch', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { store, fetches } = setup(async () => (await gate, image()()));
    const both = [store.save(ref('a'), new Set()), store.save(ref('a'), new Set())];
    await new Promise((r) => setTimeout(r, 20));
    release();
    expect(await Promise.all(both)).toEqual(['a', 'a']);
    expect(fetches).toHaveLength(1);
    expect(await store.save(ref('a'), new Set())).toBe('a');
    expect(fetches).toHaveLength(1);
  });

  it('after a failed save, the same artwork can be saved again', async () => {
    let ok = false;
    const { store } = setup(() => (ok ? image()() : new Response('x', { status: 503 })));
    expect(await store.save(ref('a'), new Set())).toBeNull();
    ok = true;
    expect(await store.save(ref('a'), new Set())).toBe('a');
  });
});

describe('artStore eviction', () => {
  const small = { count: 3, bytes: ART_CAPS.bytes };

  it('deletes the least recently used images the caller is not keeping, until the count fits', async () => {
    const { store } = setup(image(), { caps: small });
    for (const id of ['a', 'b', 'c']) await store.save(ref(id), new Set());
    await store.save(ref('d'), new Set(['a'])); // a is oldest but kept: b goes
    expect([await store.has('a'), await store.has('b'), await store.has('c'), await store.has('d')]).toEqual([true, false, true, true]);
  });

  it('counts a use of an image (url) as recent', async () => {
    const { store, advance } = setup(image(), { caps: small });
    for (const id of ['a', 'b', 'c']) await store.save(ref(id), new Set());
    advance(61_000); // a use is recorded at one-minute resolution (see the throttle tests)
    await store.url('a'); // a is now the newest
    await store.save(ref('d'), new Set());
    expect([await store.has('a'), await store.has('b'), await store.has('c'), await store.has('d')]).toEqual([true, false, true, true]);
  });

  it('deletes by total size too', async () => {
    const { store } = setup(image(400), { caps: { count: 24, bytes: 1000 } });
    for (const id of ['a', 'b']) await store.save(ref(id), new Set());
    await store.save(ref('c'), new Set());
    expect([await store.has('a'), await store.has('b'), await store.has('c')]).toEqual([false, true, true]);
  });

  it('deletes nothing while the keep set is unknown', async () => {
    const { store } = setup(image(), { caps: { count: 1, bytes: ART_CAPS.bytes } });
    for (const id of ['a', 'b', 'c']) expect(await store.save(ref(id), null)).toBe(id);
    expect([await store.has('a'), await store.has('b'), await store.has('c')]).toEqual([true, true, true]);
  });

  it('never deletes a kept image, even over the caps, and never the one just saved', async () => {
    const { store } = setup(image(), { caps: { count: 1, bytes: ART_CAPS.bytes } });
    await store.save(ref('a'), new Set());
    await store.save(ref('b'), new Set(['a']));
    expect(await store.has('a')).toBe(true);
    expect(await store.has('b')).toBe(true);
  });

  it('revokes the object URL of an image it deletes', async () => {
    const { store, revoked } = setup(image(), { caps: { count: 1, bytes: ART_CAPS.bytes } });
    await store.save(ref('a'), new Set());
    const u = await store.url('a');
    await store.save(ref('b'), new Set());
    expect(revoked).toEqual([u]);
  });
});

describe('artStore.url, release, has, remove', () => {
  it('gives the same object URL until release, then a new one; release revokes it', async () => {
    const { store, revoked } = setup();
    await store.save(ref('a'), new Set());
    const first = await store.url('a');
    expect(first).toMatch(/^blob:/);
    expect(await store.url('a')).toBe(first);
    store.release('a');
    expect(revoked).toEqual([first]);
    const second = await store.url('a');
    expect(second).not.toBe(first);
    store.release('a');
    store.release('a'); // twice is harmless
    expect(revoked).toHaveLength(2);
  });

  it('two overlapping url calls make one object URL', async () => {
    const { store, urls } = setup();
    await store.save(ref('a'), new Set());
    const [x, y] = await Promise.all([store.url('a'), store.url('a')]);
    expect(x).toBe(y);
    expect(urls.size).toBe(1);
  });

  it('is null for an image that was never saved', async () => {
    const { store } = setup();
    expect(await store.url('nope')).toBeNull();
    expect(await store.has('nope')).toBe(false);
  });

  it('remove deletes the row and revokes its object URL; removing nothing is fine', async () => {
    const { store, revoked } = setup();
    await store.save(ref('a'), new Set());
    const u = await store.url('a');
    expect(await store.remove('a')).toBe(true);
    expect(revoked).toEqual([u]);
    expect(await store.has('a')).toBe(false);
    expect(await store.url('a')).toBeNull();
    expect(await store.remove('a')).toBe(true);
  });

  it('keeps its rows across a new store on the same database', async () => {
    const name = `art-test-reopen-${dbCount++}`;
    const a = setup(image(), { dbName: name });
    await a.store.save(ref('a'), new Set());
    const b = setup(image(), { dbName: name });
    expect(await b.store.has('a')).toBe(true);
  });
});

describe('artStore with storage that is missing, throwing or full', () => {
  it('answers null and false, and never throws, when IndexedDB is missing', async () => {
    const { store, fetches } = setup(image(), { idb: null });
    expect(await store.save(ref('a'), new Set())).toBeNull();
    expect(await store.url('a')).toBeNull();
    expect(await store.has('a')).toBe(false);
    expect(await store.remove('a')).toBe(false);
    expect(() => store.release('a')).not.toThrow();
    expect(fetches).toEqual([]);
  });

  it('answers null and false when IndexedDB throws or errors on open', async () => {
    const throwing = { open: () => { throw new Error('SecurityError'); } } as unknown as IDBFactory;
    const erroring = { open: () => { const req = {} as IDBOpenDBRequest; setTimeout(() => req.onerror?.(new Event('error')), 0); return req; } } as unknown as IDBFactory;
    for (const idb of [throwing, erroring]) {
      const { store } = setup(image(), { idb });
      expect(await store.save(ref('a'), new Set())).toBeNull();
      expect(await store.url('a')).toBeNull();
      expect(await store.has('a')).toBe(false);
      expect(await store.remove('a')).toBe(false);
    }
  });

  it('a quota error while saving keeps no partial row and leaves the old images', async () => {
    const { store } = setup(image(), { caps: ART_CAPS });
    await store.save(ref('old'), new Set());
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(await store.save(ref('new'), new Set(['old']))).toBeNull();
    spy.mockRestore();
    expect(await store.has('new')).toBe(false);
    expect(await store.has('old')).toBe(true);
  });

  it('a quota error that aborts the transaction later is handled the same way', async () => {
    const { store } = setup(image(), { caps: ART_CAPS });
    await store.save(ref('old'), new Set());
    const real = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof real>) {
      const req = real.apply(this, args);
      this.transaction.abort();
      return req;
    });
    expect(await store.save(ref('new'), new Set(['old']))).toBeNull();
    spy.mockRestore();
    expect(await store.has('new')).toBe(false);
    expect(await store.has('old')).toBe(true);
  });

  it('a failed delete during eviction still reports the image as saved', async () => {
    const { store } = setup(image(), { caps: { count: 1, bytes: ART_CAPS.bytes } });
    await store.save(ref('a'), new Set());
    vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(() => { throw new Error('blocked'); });
    expect(await store.save(ref('b'), new Set())).toBe('b');
  });
});

describe('artStore use bumps are throttled', () => {
  it('many url() calls inside a minute rewrite the image row once (the save), not once per call', async () => {
    const { store } = setup();
    await store.save(ref('a'), new Set());
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    for (let i = 0; i < 20; i++) expect(await store.url('a')).toMatch(/^blob:/);
    expect(await store.save(ref('a'), new Set())).toBe('a');
    expect(put).not.toHaveBeenCalled();
  });

  it('writes the row again once a minute has passed, then not again until the next minute', async () => {
    const { store, advance } = setup();
    await store.save(ref('a'), new Set());
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    advance(61_000);
    await store.url('a');
    await store.url('a');
    expect(put).toHaveBeenCalledTimes(1);
    advance(61_000);
    await store.url('a');
    expect(put).toHaveBeenCalledTimes(2);
  });

  it('a first use after a reload (nothing tracked in memory) is recorded once', async () => {
    const name = `art-test-bump-${dbCount++}`;
    await setup(image(), { dbName: name }).store.save(ref('a'), new Set());
    const { store } = setup(image(), { dbName: name });
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    await store.url('a');
    await store.url('a');
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('a delete between two uses is not undone by a later bump', async () => {
    const { store, advance } = setup();
    await store.save(ref('a'), new Set());
    await store.url('a');
    expect(await store.remove('a')).toBe(true);
    advance(61_000);
    expect(await store.url('a')).toBeNull();
    expect(await store.has('a')).toBe(false);
  });

  it('eviction still goes by last use once uses are a minute apart', async () => {
    const { store, advance } = setup(image(), { caps: { count: 3, bytes: ART_CAPS.bytes } });
    for (const id of ['a', 'b', 'c']) {
      await store.save(ref(id), new Set());
      advance(61_000);
    }
    await store.url('a');
    advance(61_000);
    await store.url('b');
    advance(61_000);
    await store.save(ref('d'), new Set()); // c was used least recently
    expect([await store.has('a'), await store.has('b'), await store.has('c'), await store.has('d')]).toEqual([true, true, false, true]);
  });
});

describe('artStore keeps one healthy connection', () => {
  it('a blocked open is waited out, not failed: the call succeeds and only one connection is opened', async () => {
    const { factory, conns, opens } = spyFactory((req) => queueMicrotask(() => req.onblocked?.(new Event('blocked') as IDBVersionChangeEvent)));
    const { store } = setup(image(), { idb: factory });
    expect(await store.save(ref('a'), new Set())).toBe('a');
    expect(await store.has('a')).toBe(true);
    expect(opens()).toBe(1);
    expect(conns).toHaveLength(1);
  });

  it('closes its connection when another tab upgrades the database, so that upgrade is not blocked', async () => {
    const name = `art-test-upgrade-${dbCount++}`;
    const { factory } = spyFactory();
    const { store } = setup(image(), { idb: factory, dbName: name });
    expect(await store.save(ref('a'), new Set())).toBe('a');
    const upgraded = await new Promise<IDBDatabase | string>((resolve) => {
      const req = indexedDB.open(name, 2);
      req.onsuccess = () => resolve(req.result);
      req.onblocked = () => resolve('blocked');
      req.onerror = () => resolve('error');
      setTimeout(() => resolve('timeout'), 500);
    });
    expect(upgraded).not.toBe('blocked');
    expect(upgraded).not.toBe('timeout');
    (upgraded as IDBDatabase).close();
  });

  it('opens a new connection after the browser reports the old one closed', async () => {
    const { factory, conns, opens } = spyFactory();
    const { store } = setup(image(), { idb: factory });
    expect(await store.save(ref('a'), new Set())).toBe('a');
    conns[0].close();
    conns[0].onclose?.(new Event('close'));
    expect(await store.has('a')).toBe(true);
    expect(await store.url('a')).toMatch(/^blob:/);
    expect(opens()).toBe(2);
  });

  it('recovers when a connection is dead and nobody was told: the next call reopens', async () => {
    const { factory, conns, opens } = spyFactory();
    const { store } = setup(image(), { idb: factory });
    expect(await store.save(ref('a'), new Set())).toBe('a');
    conns[0].close(); // as when Safari drops it: no event reached the store
    expect(await store.has('a')).toBe(true);
    expect(await store.url('a')).toMatch(/^blob:/);
    expect(await store.remove('a')).toBe(true);
    expect(opens()).toBe(2);
  });

  it('a failed open is tried again on the next call', async () => {
    let failures = 1;
    const { factory, opens } = spyFactory();
    const flaky = { open: (n: string, v?: number) => { if (failures-- > 0) throw new Error('SecurityError'); return factory.open(n, v); } } as unknown as IDBFactory;
    const { store } = setup(image(), { idb: flaky });
    expect(await store.save(ref('a'), new Set())).toBeNull();
    expect(await store.save(ref('a'), new Set())).toBe('a');
    expect(await store.has('a')).toBe(true);
    expect(opens()).toBe(1);
  });
});
