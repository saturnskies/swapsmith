/**
 * Card art kept on the device so a Life Counter seat still shows it with no signal: one row per artwork
 * ({ id, blob, bytes, lastUsed }) in its own IndexedDB database, `swapsmith-art`, never in localStorage.
 * At most ART_CAPS.count images and ART_CAPS.bytes in all; after a save the least recently used image the caller
 * isn't keeping is deleted first. Storage can be missing, blocked or full: every method then answers null or false.
 */

import { planEviction, type ArtRef } from '../lib/art';

export const ART_DB = 'swapsmith-art';
export const ART_CAPS = { count: 24, bytes: 8 * 1024 * 1024 } as const;
/** An image over this many bytes is refused, not cached. */
export const MAX_IMAGE_BYTES = 600 * 1024;
/** The only host an image is fetched from; a stored url can come from an old or restored store, so it is data, not trusted. */
export const ART_HOST = 'cards.scryfall.io';

const STORE = 'images';

interface Row {
  id: string;
  blob: Blob;
  bytes: number;
  lastUsed: number;
}

export interface ArtStore {
  /**
   * Fetches `ref.url` and keeps the image under `ref.id`, then deletes the least recently used images (never one in
   * `keep`, never this one) until the caps hold. `keep` is the ids the current game and remembered setup use; null when
   * that isn't known, and then nothing is deleted. Answers the id, or null when nothing was saved (bad url, offline,
   * not an image, empty, too big, storage unavailable or full). The same id saved twice at once is one fetch and one row.
   */
  save(ref: ArtRef, keep: ReadonlySet<string> | null): Promise<string | null>;
  /** An object URL for the saved image (the same one until `release`), or null; counts as a use. */
  url(id: string): Promise<string | null>;
  /** Revokes the object URL `url(id)` gave. Call it when the tile showing it is redrawn or gone. */
  release(id: string): void;
  has(id: string): Promise<boolean>;
  /** Deletes the image; true when storage answered. */
  remove(id: string): Promise<boolean>;
}

export interface ArtStoreOptions {
  dbName?: string;
  /** The IndexedDB to use; null means there is none. Defaults to the browser's. */
  idb?: IDBFactory | null;
  fetch?: typeof fetch;
  now?: () => number;
  caps?: { count: number; bytes: number };
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
}

/** True only for a plain https URL on the art host: no credentials, no other port. */
export function isArtUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && u.hostname === ART_HOST && u.username === '' && u.password === '' && u.port === '';
  } catch {
    return false;
  }
}

export function createArtStore(opts: ArtStoreOptions = {}): ArtStore {
  const dbName = opts.dbName ?? ART_DB;
  const doFetch = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = opts.now ?? (() => Date.now());
  const caps = opts.caps ?? ART_CAPS;
  const makeUrl = opts.createObjectURL ?? ((b: Blob) => URL.createObjectURL(b));
  const revokeUrl = opts.revokeObjectURL ?? ((u: string) => URL.revokeObjectURL(u));

  let dbp: Promise<IDBDatabase> | undefined;
  const db = () => {
    if (dbp) return dbp;
    const attempt = new Promise<IDBDatabase>((resolve, reject) => {
      const factory = opts.idb === undefined ? (typeof indexedDB === 'undefined' ? null : indexedDB) : opts.idb;
      if (!factory) return reject(new Error('IndexedDB is not available'));
      const req = factory.open(dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB is blocked'));
    });
    dbp = attempt;
    // A failed open is tried again on the next call rather than disabling the store until reload.
    attempt.catch(() => {
      if (dbp === attempt) dbp = undefined;
    });
    return attempt;
  };

  /** Runs `fn` in one transaction and answers with its result once the transaction has committed. */
  async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const t = (await db()).transaction(STORE, mode);
    return new Promise<T>((resolve, reject) => {
      let result: T;
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted'));
      const req = fn(t.objectStore(STORE));
      req.onsuccess = () => (result = req.result);
    });
  }

  /** Marks the row as used now, in the same transaction that reads it, so a row deleted meanwhile is not brought back. */
  async function touch(id: string): Promise<Row | undefined> {
    const t = (await db()).transaction(STORE, 'readwrite');
    return new Promise<Row | undefined>((resolve, reject) => {
      let row: Row | undefined;
      t.oncomplete = () => resolve(row);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted'));
      const store = t.objectStore(STORE);
      const req = store.get(id);
      req.onsuccess = () => {
        row = req.result;
        if (row) store.put({ ...row, lastUsed: now() });
      };
    });
  }

  const getRow = (id: string) => run<Row | undefined>('readonly', (s) => s.get(id));
  const putRow = (row: Row) => run('readwrite', (s) => s.put(row));
  const deleteRow = (id: string) => run('readwrite', (s) => s.delete(id));
  const allRows = () => run<Row[]>('readonly', (s) => s.getAll());

  const objectUrls = new Map<string, string>();
  const pendingUrls = new Map<string, Promise<string | null>>();
  const saving = new Map<string, Promise<string | null>>();

  const release = (id: string) => {
    const u = objectUrls.get(id);
    if (u === undefined) return;
    objectUrls.delete(id);
    revokeUrl(u);
  };

  /** The image's bytes, or null for anything that is not a whole, small image. */
  async function download(url: string): Promise<Blob | null> {
    if (!isArtUrl(url)) return null;
    try {
      // A redirect could lead off the art host, so none is followed.
      const res = await doFetch(url, { mode: 'cors', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
      if (!res.ok) return null;
      const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (!type.startsWith('image/') || type === 'image/svg+xml') return null;
      const declared = Number(res.headers.get('content-length'));
      if (declared > MAX_IMAGE_BYTES) return null;
      const blob = await res.blob();
      if (blob.size === 0 || blob.size > MAX_IMAGE_BYTES) return null;
      // A body cut off part-way is shorter than the length the server announced.
      if (declared > 0 && blob.size !== declared) return null;
      return blob.type === type ? blob : blob.slice(0, blob.size, type);
    } catch {
      return null;
    }
  }

  async function evict(keep: ReadonlySet<string>) {
    const entries = (await allRows()).map((r) => ({ id: r.id, bytes: r.bytes, lastUsed: r.lastUsed }));
    for (const id of planEviction(entries, keep, caps).remove) {
      await deleteRow(id);
      release(id);
    }
  }

  async function doSave(ref: ArtRef, keep: ReadonlySet<string> | null): Promise<string | null> {
    try {
      if (await touch(ref.id)) return ref.id;
      const blob = await download(ref.url);
      if (!blob) return null;
      try {
        await putRow({ id: ref.id, blob, bytes: blob.size, lastUsed: now() });
      } catch {
        // Full or blocked: the transaction is rolled back as a whole, so no half-written row stays and the old images are intact.
        return null;
      }
      if (keep) await evict(new Set([...keep, ref.id])).catch(() => undefined);
      return ref.id;
    } catch {
      return null;
    }
  }

  return {
    save(ref, keep) {
      const running = saving.get(ref.id);
      if (running) return running;
      const p = doSave(ref, keep).finally(() => saving.delete(ref.id));
      saving.set(ref.id, p);
      return p;
    },

    url(id) {
      const running = pendingUrls.get(id);
      if (running) return running;
      const p = (async () => {
        try {
          const row = await touch(id);
          if (!row) return release(id), null;
          let u = objectUrls.get(id);
          if (u === undefined) objectUrls.set(id, (u = makeUrl(row.blob)));
          return u;
        } catch {
          return null;
        }
      })().finally(() => pendingUrls.delete(id));
      pendingUrls.set(id, p);
      return p;
    },

    release,

    async has(id) {
      try {
        return (await getRow(id)) !== undefined;
      } catch {
        return false;
      }
    },

    async remove(id) {
      try {
        await deleteRow(id);
        release(id);
        return true;
      } catch {
        return false;
      }
    },
  };
}
