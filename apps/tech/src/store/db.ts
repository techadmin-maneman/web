// Everything the phone holds, in one IndexedDB database. It is app-private, as
// the design's open question asks ("Needs an app-private store, not the camera
// roll"), and it is wiped whole when the session ends or ops revoke the device.
//
//   device   the device's own ID and label, made once at enrolment
//   jobs     today's and tomorrow's jobs and cards, so the app opens in a basement
//   outbox   the writes that have not reached us, in the order they were queued
//   frames   photograph frames, held until the API confirms the upload

export const DATABASE = "mm-tech";

/** The one cache the service worker keeps an API answer in, wiped with the database. */
export const DAY_CACHE = "mm-tech-day";

export const STORES = ["device", "jobs", "outbox", "frames"] as const;
export type StoreName = (typeof STORES)[number];

/**
 * How the database reaches each version, one step at a time. A phone opens it
 * at whatever version it last had and runs every step it missed, in order, and
 * none twice. A new step goes at the end, and an old one is never edited: some
 * phone somewhere has not run it yet.
 */
const UPGRADES: readonly ((db: IDBDatabase) => void)[] = [
  // Version 1: the four stores. The outbox's key counts up, so reading it in key order is the order the phone queued them in.
  (db) => {
    db.createObjectStore("device", { keyPath: "key" });
    db.createObjectStore("jobs", { keyPath: "id" });
    db.createObjectStore("outbox", { keyPath: "seq", autoIncrement: true }).createIndex("job", "job_id");
    db.createObjectStore("frames", { keyPath: "id" });
  },
];
const VERSION = UPGRADES.length;

/**
 * The shape of every record written now, stamped on it as `v`. A build that
 * changes a record's shape raises it, so the step it adds to UPGRADES can tell
 * the records it must move from the ones already moved. A record from before
 * the stamp has none, and is version 1.
 */
export const RECORD_VERSION = 1;

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
      for (const step of UPGRADES.slice(event.oldVersion)) step(request.result);
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

export async function all<T>(name: StoreName): Promise<T[]> {
  return settle((await store(name, "readonly")).getAll() as IDBRequest<T[]>);
}

export async function get<T>(name: StoreName, key: IDBValidKey): Promise<T | null> {
  const found = await settle((await store(name, "readonly")).get(key) as IDBRequest<T | undefined>);
  return found ?? null;
}

/** The stores whose last write failed for want of room. The phone is full while any is here. */
const full = new Set<StoreName>();
const fullListeners = new Set<(isFull: boolean) => void>();

/** App says so on every screen while the phone is full (apps/tech/src/App.tsx). */
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
async function write<T>(name: StoreName, act: (target: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const transaction = (await open()).transaction(name, "readwrite");
  try {
    const [result] = await Promise.all([settle(act(transaction.objectStore(name))), committed(transaction)]);
    roomIn(name, true);
    return result;
  } catch (error) {
    if (!isNoRoom(error)) throw error;
    roomIn(name, false);
    throw new StorageFull();
  }
}

const stamped = (value: object) => ({ ...value, v: RECORD_VERSION });

export async function put(name: StoreName, value: object): Promise<void> {
  await write(name, (target) => target.put(stamped(value)));
}

/** Adds a value the store keys itself, and answers with the key it was given. */
export async function add(name: StoreName, value: object): Promise<number> {
  return Number(await write(name, (target) => target.add(stamped(value))));
}

export async function remove(name: StoreName, key: IDBValidKey): Promise<void> {
  await write(name, (target) => target.delete(key));
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
 * The service worker's day cache goes with it. It holds no client's name — the
 * day's list carries none — but it is a technician's day, and a phone that is
 * no longer ours keeps none of it (apps/tech/sw/sw.ts).
 *
 * A delete held up by another connection is not abandoned when the wait runs
 * out: the browser carries it out the moment that connection closes.
 */
export async function wipe(patience: number = WIPE_WAIT_MS): Promise<void> {
  // No cache storage outside a secure context, and none in the development server.
  if (typeof caches !== "undefined") await caches.delete(DAY_CACHE).catch(() => false);
  const db = await open().catch(() => null);
  db?.close();
  opening = null;
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DATABASE);
    request.onsuccess = () => {
      resolve();
    };
    // A wipe that cannot finish must not strand the sign-out; the next open finds an empty store either way.
    request.onerror = () => {
      resolve();
    };
    request.onblocked = () => {
      setTimeout(resolve, patience);
    };
  });
  // Whatever the phone was full of has just gone.
  for (const name of STORES) roomIn(name, true);
}
