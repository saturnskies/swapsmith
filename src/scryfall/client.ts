/**
 * The one way the app talks to Scryfall: requests are queued about 100 ms
 * apart (Scryfall asks for under ~10/s), searches and lookups 500 ms apart,
 * 429s and dropped connections are retried with backoff, and responses are
 * cached for 24 h (prices only change daily). Two callers asking for the
 * same thing at once share one request. A reply up to a week old is kept
 * for when Scryfall can't be reached (offline, at a game table), and
 * anything older is deleted so the cache can't grow without limit.
 */

export const SCRYFALL_BASE = 'https://api.scryfall.com';

export type CacheEntry = { t: number; body: unknown };

export interface CacheStore {
  get(key: string): Promise<CacheEntry | undefined>;
  set(key: string, entry: CacheEntry): Promise<void>;
  /** Deletes every entry saved before `cutoff` (a time in ms). */
  prune?(cutoff: number): Promise<void>;
}

/** Whether replies come from the network, or (when it can't be reached) from older saved copies. */
export type NetworkState = 'live' | 'saved';

export interface ClientOptions {
  /** Another host with the same queue, retry and cache (EDHREC). Defaults to Scryfall. */
  base?: string;
  /** The host's name in error messages. */
  service?: string;
  fetch?: typeof fetch;
  cache?: CacheStore;
  spacingMs?: number;
  /** Minimum gap between Scryfall's heavier endpoints (search, named, collection), which rate-limit sooner. */
  heavySpacingMs?: number;
  ttlMs?: number;
  /** How long a saved reply may stand in when the host can't be reached; older entries are deleted. */
  staleMs?: number;
  /** Told 'saved' when an out-of-date saved reply was used because the host couldn't be reached, 'live' when it answers again. */
  onNetwork?: (state: NetworkState) => void;
  /** True when the device knows it has no connection, so a saved reply is used at once instead of after the retries. */
  offline?: () => boolean;
  maxRetries?: number;
  /** Most requests open at once; start times are also spaced by spacingMs. */
  maxInFlight?: number;
  /** A request with no answer after this long is abandoned and retried like a dropped connection. */
  timeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Per-call options. */
export interface GetOptions {
  /** Ask the network every time: no cache read, no cache write, no sharing with an identical call in flight, no saved reply on failure. For endpoints that answer differently each time (`/cards/random`). */
  fresh?: boolean;
}

export interface ScryfallClient {
  get<T = unknown>(path: string, opts?: GetOptions): Promise<T>;
  post<T = unknown>(path: string, body: unknown): Promise<T>;
}

export class ScryfallError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'ScryfallError';
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const browserOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

export function createClient(opts: ClientOptions = {}): ScryfallClient {
  const base = opts.base ?? SCRYFALL_BASE;
  const service = opts.service ?? 'Scryfall';
  // Another host's replies are cached under its own base, so a shared cache can't mix them up.
  const keyPrefix = base === SCRYFALL_BASE ? '' : `${base} `;
  const doFetch = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const cache = opts.cache ?? idbCache();
  const spacingMs = opts.spacingMs ?? 100;
  const heavySpacingMs = opts.heavySpacingMs ?? 500;
  const ttlMs = opts.ttlMs ?? DAY_MS;
  const staleMs = Math.max(opts.staleMs ?? 7 * DAY_MS, ttlMs);
  const onNetwork = opts.onNetwork ?? (() => {});
  const offline = opts.offline ?? browserOffline;
  const maxRetries = opts.maxRetries ?? 3;
  const maxInFlight = opts.maxInFlight ?? 4;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  // Start times are handed out spacingMs apart, and at most maxInFlight requests are open at once.
  // Replies may overlap, so one slow reply doesn't hold up the rest.
  let queue: Promise<void> = Promise.resolve();
  let lastStart = -Infinity;
  let lastHeavyStart = -Infinity;
  let open = 0;
  const waiting: Array<() => void> = [];

  const acquire = () => (open < maxInFlight ? (open += 1, Promise.resolve()) : new Promise<void>((r) => waiting.push(r)));
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else open -= 1;
  };

  // Scryfall returned 429s to bursts of searches at 10/s (2026-11-02), so these go out at most ~2/s.
  const isHeavy = (path: string) => /^\/cards\/(search|named|collection)\b/.test(path);

  const throttled = <T>(path: string, task: () => Promise<T>): Promise<T> => {
    const heavy = isHeavy(path);
    const slot = queue.then(async () => {
      await acquire();
      const wait = Math.max(lastStart + spacingMs, heavy ? lastHeavyStart + heavySpacingMs : -Infinity) - now();
      if (wait > 0) await sleep(wait);
      lastStart = now();
      if (heavy) lastHeavyStart = lastStart;
    });
    queue = slot;
    return slot.then(async () => {
      try {
        return await task();
      } finally {
        release();
      }
    });
  };

  /** Requests on their way, by cache key: a second caller asking for the same thing waits for the first one's reply. */
  const inFlight = new Map<string, Promise<unknown>>();
  let pruned = false;

  async function send<T>(path: string, init: RequestInit, cacheKey: string, fresh = false): Promise<T> {
    if (fresh) return fetchAndCache<T>(path, init, cacheKey, undefined, false);
    const hit = await safe(() => cache.get(cacheKey));
    if (hit && now() - hit.t <= ttlMs) return hit.body as T;

    const pending = inFlight.get(cacheKey);
    if (pending) return pending as Promise<T>;
    // A saved reply past its TTL still beats an error when the host can't be reached.
    const saved = hit && now() - hit.t <= staleMs ? hit : undefined;
    const request = fetchAndCache<T>(path, init, cacheKey, saved).finally(() => inFlight.delete(cacheKey));
    inFlight.set(cacheKey, request);
    return request;
  }

  async function fetchAndCache<T>(path: string, init: RequestInit, cacheKey: string, saved: CacheEntry | undefined, store = true): Promise<T> {
    const useSaved = () => {
      onNetwork('saved');
      return saved!.body as T;
    };
    if (saved && offline()) return useSaved();

    for (let attempt = 0; ; attempt += 1) {
      let res: Response;
      try {
        res = await throttled(path, async () => {
          const abort = new AbortController();
          const timer = setTimeout(() => abort.abort(), timeoutMs);
          try {
            return await doFetch(base + path, { ...init, signal: abort.signal });
          } finally {
            clearTimeout(timer);
          }
        });
      } catch (e) {
        // A dropped connection, a request that timed out, or a reply the browser blocks (such as a
        // rate-limit page without CORS headers) has no status: back off and retry like a 429.
        if (attempt < maxRetries) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        if (saved) return useSaved();
        throw new ScryfallError(0, `Couldn't reach ${service}: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (res.status === 429 && attempt < maxRetries) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        // The host is up but failing or still rate-limiting (429, 5xx): a saved reply beats an error. A 4xx is an answer.
        if (saved && (res.status === 429 || res.status >= 500)) return useSaved();
        const details = (body && typeof body === 'object' && 'details' in body && String(body.details)) || res.statusText;
        throw new ScryfallError(res.status, `${service} ${res.status}: ${details}`);
      }
      onNetwork('live');
      if (!store) return body as T;
      await safe(() => cache.set(cacheKey, { t: now(), body }));
      // Once per session, after the first fresh reply: drop saved replies too old to ever be used again.
      if (!pruned) {
        pruned = true;
        void safe(async () => cache.prune?.(now() - staleMs));
      }
      return body as T;
    }
  }

  return {
    get: (path, o) => send(path, { headers: { Accept: 'application/json' } }, `${keyPrefix}GET ${path}`, o?.fresh === true),
    post: (path, body) => {
      const text = JSON.stringify(body);
      return send(path, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: text }, `${keyPrefix}POST ${path} ${text}`);
    },
  };
}

/** Storage can be blocked (private windows); the app must still work without it. */
async function safe<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    return undefined;
  }
}

export function memoryCache(): CacheStore {
  const m = new Map<string, CacheEntry>();
  return {
    get: async (k) => m.get(k),
    set: async (k, v) => void m.set(k, v),
    prune: async (cutoff) => {
      for (const [k, v] of m) if (v.t < cutoff) m.delete(k);
    },
  };
}

/**
 * Replies saved in IndexedDB. Version 2 of the database indexes entries by the time they were saved,
 * so old ones can be deleted without reading them; version 1 had no way to delete anything, and its
 * entries (megabytes per deck) are dropped on upgrade: it is only a cache.
 */
export function idbCache(dbName = 'swapsmith-cache'): CacheStore {
  const STORE = 'responses';
  const BY_TIME = 'by-time';
  let dbp: Promise<IDBDatabase> | undefined;
  const db = () =>
    (dbp ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName, 2);
      req.onupgradeneeded = () => {
        if (req.result.objectStoreNames.contains(STORE)) req.result.deleteObjectStore(STORE);
        req.result.createObjectStore(STORE).createIndex(BY_TIME, 't');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  const tx = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) => {
    const store = (await db()).transaction(STORE, mode).objectStore(STORE);
    return new Promise<T>((resolve, reject) => {
      const req = fn(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  };
  return {
    get: (k) => tx<CacheEntry | undefined>('readonly', (s) => s.get(k)),
    set: async (k, v) => void (await tx('readwrite', (s) => s.put(v, k))),
    prune: async (cutoff) => {
      const t = (await db()).transaction(STORE, 'readwrite');
      const store = t.objectStore(STORE);
      await new Promise<void>((resolve, reject) => {
        // Keys only: the saved replies themselves are never read.
        const req = store.index(BY_TIME).openKeyCursor(IDBKeyRange.upperBound(cutoff, true));
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return;
          store.delete(cursor.primaryKey);
          cursor.continue();
        };
        t.oncomplete = () => resolve();
        t.onerror = t.onabort = () => reject(t.error);
      });
    },
  };
}
