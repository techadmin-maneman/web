// The technician app's own store (apps/tech/src/store/db.ts), on an IndexedDB
// that runs in Node. What is checked is what a phone in the field depends on:
// a store another build or tab can take over, a write that says when the phone
// is full, and a wipe that leaves nothing behind.

import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DATABASE,
  firstIn,
  get,
  onStorageFull,
  open,
  put,
  RECORD_VERSION,
  STEP_INDEX,
  StorageFull,
  wipe,
  type StoreName,
} from "../../../apps/tech/src/store/db.ts";

afterEach(async () => {
  vi.restoreAllMocks();
  await wipe();
});

/** Asks for the database to be deleted from outside the app, as another tab or build would. */
function deletedFromOutside(): Promise<"deleted" | "blocked"> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(DATABASE);
    request.onsuccess = () => {
      resolve("deleted");
    };
    request.onblocked = () => {
      resolve("blocked");
    };
  });
}

/** A database made as the first release made it, at version 1, holding one record in one store. */
function firstRelease(record: object, name: StoreName = "jobs"): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("device", { keyPath: "key" });
      db.createObjectStore("jobs", { keyPath: "id" });
      db.createObjectStore("outbox", { keyPath: "seq", autoIncrement: true }).createIndex("job", "job_id");
      db.createObjectStore("frames", { keyPath: "id" });
    };
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(name, "readwrite");
      transaction.objectStore(name).put(record);
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onabort = () => {
        reject(new Error("could not seed the first release's store"));
      };
    };
  });
}

describe("the phone's store", () => {
  it("opens with the four stores the app keeps", async () => {
    const db = await open();
    expect([...db.objectStoreNames].sort()).toEqual(["device", "frames", "jobs", "outbox"]);
  });

  it("opens a store the first release made, and keeps what it held", async () => {
    await firstRelease({ id: "day:2030-09-01", kind: "day", date: "2030-09-01", jobs: [] });
    expect(await get("jobs", "day:2030-09-01")).toMatchObject({ kind: "day", date: "2030-09-01" });
  });

  it("finds an event the first release queued by its job, kind and state", async () => {
    const event = { seq: 1, id: "e", job_id: "a", kind: "start", state: "waiting", body: null };
    await firstRelease(event, "outbox");
    expect(await firstIn("outbox", STEP_INDEX, ["a", "start", "waiting"])).toEqual(event);
  });

  it("marks every record with the version of its shape, so a later build can tell old from new", async () => {
    await put("device", { key: "device", id: "phone" });
    expect(await get("device", "device")).toEqual({ key: "device", id: "phone", v: RECORD_VERSION });
  });

  it("tries again after the store once would not open, rather than failing for good", async () => {
    vi.spyOn(indexedDB, "open").mockImplementationOnce(() => {
      throw new DOMException("not now", "InvalidStateError");
    });
    await expect(get("device", "device")).rejects.toMatchObject({ name: "InvalidStateError" });
    expect(await get("device", "device")).toBeNull();
  });

  it("lets go of the database when another tab or build asks for it, rather than blocking it", async () => {
    await put("device", { key: "device", id: "phone" });
    expect(await deletedFromOutside()).toBe("deleted");
    // And opens it afresh on the next call.
    expect(await get("device", "device")).toBeNull();
  });
});

describe("a phone with no room left", () => {
  const full = () => {
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
      throw new DOMException("no room", "QuotaExceededError");
    });
  };

  it("refuses the write as storage full, which the screens can say plainly", async () => {
    full();
    await expect(put("frames", { id: "frame" })).rejects.toBeInstanceOf(StorageFull);
  });

  it("tells the app the phone is full, and that it is not once a write to the same store lands", async () => {
    const heard: boolean[] = [];
    const stop = onStorageFull((isFull) => heard.push(isFull));
    full();
    await put("frames", { id: "frame" }).catch(() => undefined);
    // A small write elsewhere landing says nothing about room for a photograph.
    await put("device", { key: "device", id: "phone" });
    expect(heard).toEqual([true]);
    await put("frames", { id: "frame" });
    expect(heard).toEqual([true, false]);
    stop();
  });

  it("passes any other failure on as it is", async () => {
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
      throw new DOMException("not cloneable", "DataCloneError");
    });
    await expect(put("frames", { id: "frame" })).rejects.toMatchObject({ name: "DataCloneError" });
  });
});

describe("the wipe", () => {
  it("leaves no database behind", async () => {
    await put("device", { key: "device", id: "phone" });
    await wipe();
    const names = (await indexedDB.databases()).map((each) => each.name);
    expect(names).not.toContain(DATABASE);
  });

  it("finishes while the app itself still has the database open elsewhere", async () => {
    await put("device", { key: "device", id: "phone" });
    const racing = get("device", "device");
    await wipe();
    await racing;
    const names = (await indexedDB.databases()).map((each) => each.name);
    expect(names).not.toContain(DATABASE);
  });

  it("does not strand the sign-in on a connection that never lets go, and deletes once it does", async () => {
    await put("device", { key: "device", id: "phone" });
    const stubborn = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open(DATABASE);
      request.onsuccess = () => {
        resolve(request.result);
      };
    });
    await wipe(50);
    stubborn.close();
    await vi.waitFor(async () => {
      const names = (await indexedDB.databases()).map((each) => each.name);
      expect(names).not.toContain(DATABASE);
    });
  });
});
