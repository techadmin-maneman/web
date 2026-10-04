// Everything the phone holds, in one IndexedDB database. It is app-private, as
// the design's open question asks ("Needs an app-private store, not the camera
// roll"), and it is wiped whole when the session ends or ops revoke the device. A technician ops switch off keeps
// the work he has not sent for a while (./set-aside.ts).
//
//   device    the device's own ID and label, made once at enrolment, and who is signed in
//   days      today's and tomorrow's lists, so the app opens in a basement
//   cards     the clients' cards of those days' jobs
//   arrivals  what each check-in measured
//   closures  when each job was closed out on the phone
//   starts    each job's start as its card showed it at check-in
//   outbox    the writes that have not reached us, in the order they were queued
//   frames    photograph frames, held until the API confirms the upload
//
// What each holds is ./records.ts, and how the database reaches each version ./upgrades.ts.

import type { DeviceRecord, Records } from "./records.ts";
import { RECORD_VERSION, STEP_INDEX, UPGRADES } from "./upgrades.ts";

export { RECORD_VERSION, STEP_INDEX };

export const DATABASE = "mm-tech";

/** The one cache the service worker keeps an API answer in, wiped with the database. */
export const DAY_CACHE = "mm-tech-day";

export const STORES = ["device", "days", "cards", "arrivals", "closures", "starts", "outbox", "frames"] as const;
export type StoreName = (typeof STORES)[number] & keyof Records;

const VERSION = UPGRADES.length;

/** A write the phone had no room for. The screens say so plainly, rather than that the camera failed. */
export class StorageFull extends Error {
  constructor() {
    super("the phone's storage is full");
    this.name = "StorageFull";
  }
}

let opening: Promise<IDBDatabase> | null = null;

function settle<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("the phone's store refused the request"));
    };
  });
}

/** Settles when the transaction commits, which is when the phone has really kept a write, not before. */
function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve();
    };
    transaction.onabort = () => {
      reject(transaction.error ?? new Error("the phone's store did not keep the write"));
    };
  });
}

function connect(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = (event) => {
      const upgrade = request.transaction;
      if (upgrade === null) return;
      for (const step of UPGRADES.slice(event.oldVersion)) step(request.result, upgrade);
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab, a newer build or this app's own wipe needs the database:
      // let go of it at once, so none of them waits on us, and open afresh next time.
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      // The browser closed it under us, as it may when the phone clears the site's data.
      db.onclose = () => {
        opening = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("the phone's store could not be opened"));
    };
  });
}

/** The one connection every read and write shares. An open that failed is tried afresh next time, not kept. */
export function open(): Promise<IDBDatabase> {
  opening ??= connect().catch((error: unknown) => {
    opening = null;
    throw error;
  });
  return opening;
}

async function store(name: StoreName, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return (await open()).transaction(name, mode).objectStore(name);
}

// What a store answers is what this app put in it, in today's shape (./upgrades.ts): the one place it is taken on trust.

export async function all<S extends StoreName>(name: S): Promise<Records[S][]> {
  return settle((await store(name, "readonly")).getAll() as IDBRequest<Records[S][]>);
}

export async function get<S extends StoreName>(name: S, key: IDBValidKey): Promise<Records[S] | null> {
  const found = await settle((await store(name, "readonly")).get(key) as IDBRequest<Records[S] | undefined>);
  return found ?? null;
}

/** The first value an index holds under a key. */
export async function firstIn<S extends StoreName>(
  name: S,
  index: string,
  key: IDBValidKey,
): Promise<Records[S] | null> {
  const found = await settle(
    (await store(name, "readonly")).index(index).get(key) as IDBRequest<Records[S] | undefined>,
  );
  return found ?? null;
}

/** The device store's record under one of its keys. */
export async function deviceRecord<K extends DeviceRecord["key"]>(
  key: K,
): Promise<Extract<DeviceRecord, { readonly key: K }> | null> {
  const found = await get("device", key);
  const isIt = (record: DeviceRecord): record is Extract<DeviceRecord, { readonly key: K }> => record.key === key;
  return found !== null && isIt(found) ? found : null;
}

/** The stores whose last write failed for want of room. The phone is full while any is here. */
const full = new Set<StoreName>();
const fullListeners = new Set<(isFull: boolean) => void>();

/** Whether the phone is full now: a write to some store found no room, and none to it has landed since. */
export const isStorageFull = (): boolean => full.size > 0;

/** The screens say so while the phone is full (apps/tech/src/components/Banners.tsx). */
export function onStorageFull(listener: (isFull: boolean) => void): () => void {
  fullListeners.add(listener);
  return () => {
    fullListeners.delete(listener);
  };
}

/**
 * Records whether a write to this store found room. Only a write to the same
 * store clears it: a card landing says nothing about room for a photograph.
 */
function roomIn(name: StoreName, found: boolean): void {
  const wasFull = full.size > 0;
  if (found) full.delete(name);
  else full.add(name);
  if (full.size > 0 !== wasFull) for (const listener of fullListeners) listener(full.size > 0);
}

const isNoRoom = (error: unknown) => error instanceof DOMException && error.name === "QuotaExceededError";

/** One write, settled once it commits. A write the phone has no room for fails as StorageFull. */
async function write<T>(name: StoreName, act: (target: IDBObjectStore) => Promise<T>): Promise<T> {
  const transaction = (await open()).transaction(name, "readwrite");
  try {
    const [result] = await Promise.all([act(transaction.objectStore(name)), committed(transaction)]);
    roomIn(name, true);
    return result;
  } catch (error) {
    if (!isNoRoom(error)) throw error;
    roomIn(name, false);
    throw new StorageFull();
  }
}

const stamped = (value: object) => ({ ...value, v: RECORD_VERSION });

export async function put<S extends StoreName>(name: S, value: Records[S]): Promise<void> {
  await write(name, (target) => settle(target.put(stamped(value))));
}

/**
 * Adds a value the store keys itself, unless the index already holds one under `key`: both in one transaction, so two
 * screens adding the same thing at once keep one. Answers the key of the value kept, and whether it is the new one.
 */
export async function addUnless(
  name: "outbox",
  index: string,
  key: IDBValidKey,
  value: object,
): Promise<{ readonly key: number; readonly added: boolean }> {
  return write(
    name,
    (target) =>
      new Promise((resolve, reject) => {
        const failed = (request: IDBRequest) => () => {
          reject(request.error ?? new Error("the phone's store refused the request"));
        };
        const found = target.index(index).getKey(key);
        found.onerror = failed(found);
        // The add is asked for in the lookup's own callback, while the transaction is certainly still open.
        found.onsuccess = () => {
          if (found.result !== undefined) {
            resolve({ key: Number(found.result), added: false });
            return;
          }
          const added = target.add(stamped(value));
          added.onerror = failed(added);
          added.onsuccess = () => {
            resolve({ key: Number(added.result), added: true });
          };
        };
      }),
  );
}

export async function remove(name: StoreName, key: IDBValidKey): Promise<void> {
  await write(name, (target) => settle(target.delete(key)));
}

/** Everything one store holds, gone; the other stores keep theirs. */
export async function clear(name: StoreName): Promise<void> {
  await write(name, (target) => settle(target.clear()));
}

/**
 * How long a wipe waits on a connection that will not let go. Every connection
 * this app opens lets go when asked (see `open`), so only an older build's, in
 * another tab, ever holds one; it must not strand the sign-in.
 */
const WIPE_WAIT_MS = 3_000;

/**
 * Everything the phone holds, gone: at sign-out, and when ops revoke the device
 * (docs/decisions/0029-sessions.md). Called on the device's next contact with
 * the backend, so nothing of a client's stays on a phone that is no longer ours.
 *
 * The service worker's day cache goes with it: today's list, which names each
 * unlocked job's client, and a phone that is no longer ours keeps none of it
 * (apps/tech/sw/sw.ts).
 *
 * A delete held up by another connection is not abandoned when the wait runs
 * out: the browser carries it out the moment that connection closes. Answers
 * false when the browser refused the delete, so the caller can try again.
 */
export async function wipe(patience: number = WIPE_WAIT_MS): Promise<boolean> {
  // No cache storage outside a secure context, and none in the development server.
  if (typeof caches !== "undefined") await caches.delete(DAY_CACHE).catch(() => false);
  const db = await open().catch(() => null);
  db?.close();
  opening = null;
  const deleted = await new Promise<boolean>((resolve) => {
    const request = indexedDB.deleteDatabase(DATABASE);
    request.onsuccess = () => {
      resolve(true);
    };
    // A wipe that cannot finish must not strand the sign-out, but the caller hears of it.
    request.onerror = () => {
      resolve(false);
    };
    request.onblocked = () => {
      setTimeout(() => {
        resolve(true);
      }, patience);
    };
  });
  // Whatever the phone was full of has just gone.
  if (deleted) for (const name of STORES) roomIn(name, true);
  return deleted;
}
