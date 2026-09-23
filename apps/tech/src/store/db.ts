// Everything the phone holds, in one IndexedDB database. It is app-private, as
// the design's open question asks ("Needs an app-private store, not the camera
// roll"), and it is wiped whole when the session ends or ops revoke the device.
//
//   device   the device's own ID and label, made once at enrolment
//   jobs     today's and tomorrow's jobs and cards, so the app opens in a basement
//   outbox   the writes that have not reached us, in the order they were queued
//   frames   photograph frames, held until the API confirms the upload

export const DATABASE = "mm-tech";
const VERSION = 1;

/** The one cache the service worker keeps an API answer in, wiped with the database. */
export const DAY_CACHE = "mm-tech-day";

export const STORES = ["device", "jobs", "outbox", "frames"] as const;
export type StoreName = (typeof STORES)[number];

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

export function open(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("device")) db.createObjectStore("device", { keyPath: "key" });
      if (!db.objectStoreNames.contains("jobs")) db.createObjectStore("jobs", { keyPath: "id" });
      // The outbox's key counts up, so reading it in key order is the order the phone queued them in.
      if (!db.objectStoreNames.contains("outbox")) {
        db.createObjectStore("outbox", { keyPath: "seq", autoIncrement: true }).createIndex("job", "job_id");
      }
      if (!db.objectStoreNames.contains("frames")) db.createObjectStore("frames", { keyPath: "id" });
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("the phone's store could not be opened"));
    };
  });
  return opening;
}

async function store(name: StoreName, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return (await open()).transaction(name, mode).objectStore(name);
}

export async function all<T>(name: StoreName): Promise<T[]> {
  return settle((await store(name, "readonly")).getAll() as IDBRequest<T[]>);
}

export async function get<T>(name: StoreName, key: IDBValidKey): Promise<T | null> {
  const found = await settle((await store(name, "readonly")).get(key) as IDBRequest<T | undefined>);
  return found ?? null;
}

export async function put(name: StoreName, value: unknown): Promise<void> {
  await settle((await store(name, "readwrite")).put(value));
}

/** Adds a value the store keys itself, and answers with the key it was given. */
export async function add(name: StoreName, value: unknown): Promise<number> {
  return Number(await settle((await store(name, "readwrite")).add(value)));
}

export async function remove(name: StoreName, key: IDBValidKey): Promise<void> {
  await settle((await store(name, "readwrite")).delete(key));
}

export async function replaceAll(name: StoreName, values: readonly unknown[]): Promise<void> {
  const target = await store(name, "readwrite");
  await settle(target.clear());
  for (const value of values) await settle(target.put(value));
}

/**
 * Everything the phone holds, gone: at sign-out, and when ops revoke the device
 * (docs/decisions/0029-sessions.md). Called on the device's next contact with
 * the backend, so nothing of a client's stays on a phone that is no longer ours.
 *
 * The service worker's day cache goes with it. It holds no client's name — the
 * day's list carries none — but it is a technician's day, and a phone that is
 * no longer ours keeps none of it (apps/tech/sw/sw.ts).
 */
export async function wipe(): Promise<void> {
  // No cache storage outside a secure context, and none in the development server.
  if (typeof caches !== "undefined") await caches.delete(DAY_CACHE).catch(() => false);
  const db = await open().catch(() => null);
  db?.close();
  opening = null;
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DATABASE);
    // A wipe that cannot finish must not strand the sign-out; the next open finds an empty store either way.
    request.onsuccess = () => {
      resolve();
    };
    request.onerror = () => {
      resolve();
    };
    request.onblocked = () => {
      resolve();
    };
  });
}
