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
} from "../../../apps/tech/src/store/db.ts";
import type { Frame } from "../../../apps/tech/src/store/records.ts";
import { firstRelease } from "./tech-first-release.ts";

const FRAME: Frame = { id: "frame", job_id: "a", angle: "front", phase: "before", frame: new Blob(["f"]), kept_at: 0 };
const PHONE = { key: "device", id: "phone", enrolled_at: null } as const;

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

describe("the phone's store", () => {
  it("opens with the stores the app keeps", async () => {
    const db = await open();
    expect([...db.objectStoreNames].sort()).toEqual([
      "arrivals",
      "cards",
      "closures",
      "days",
      "device",
      "frames",
      "outbox",
      "starts",
    ]);
  });

  // CQ-45: one jobs store held five kinds of record, told apart by their keys, and earlier shapes were mended on read.
  it("moves what the first release's jobs store held into a store each, in today's shape", async () => {
    const row = { id: "a", starts_at: "t" };
    const card = { id: "a", partial_reasons: ["piece_not_ready"], checklist: [{ id: "c", label: "C" }] };
    await firstRelease([
      { id: "day:2030-09-01", kind: "day", date: "2030-09-01", jobs: [row] },
      { id: "a", kind: "job", job: card },
      { id: "arrival:a", kind: "arrival", job_id: "a", arrival: { passed: true } },
      { id: "closed:a", kind: "closed", job_id: "a", at: 5 },
      { id: "start_at_check_in:a", kind: "start_at_check_in", job_id: "a", starts_at: "t" },
    ]);

    expect(await get("days", "2030-09-01")).toEqual({
      date: "2030-09-01",
      jobs: [{ ...row, progress: { started_at: null, outcome: null }, minutes: null }],
      v: RECORD_VERSION,
    });
    expect(await get("cards", "a")).toMatchObject({
      partial_reasons: [{ id: "piece_not_ready", label: "Piece not ready" }],
      consumables: [],
      checklist_if_declined: card.checklist,
    });
    expect(await get("arrivals", "a")).toMatchObject({ job_id: "a", arrival: { passed: true } });
    expect(await get("closures", "a")).toMatchObject({ job_id: "a", at: 5 });
    expect(await get("starts", "a")).toMatchObject({ job_id: "a", starts_at: "t" });
    expect([...(await open()).objectStoreNames]).not.toContain("jobs");
  });

  it("finds an event the first release queued by its job, kind and state", async () => {
    const event = { seq: 1, id: "e", job_id: "a", kind: "start", state: "waiting", body: null };
    await firstRelease([event], "outbox");
    expect(await firstIn("outbox", STEP_INDEX, ["a", "start", "waiting"])).toEqual(event);
  });

  it("marks every record with the version of its shape, so a later build can tell old from new", async () => {
    await put("device", PHONE);
    expect(await get("device", "device")).toEqual({ ...PHONE, v: RECORD_VERSION });
  });

  it("tries again after the store once would not open, rather than failing for good", async () => {
    vi.spyOn(indexedDB, "open").mockImplementationOnce(() => {
      throw new DOMException("not now", "InvalidStateError");
    });
    await expect(get("device", "device")).rejects.toMatchObject({ name: "InvalidStateError" });
    expect(await get("device", "device")).toBeNull();
  });

  it("lets go of the database when another tab or build asks for it, rather than blocking it", async () => {
    await put("device", PHONE);
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
    await expect(put("frames", FRAME)).rejects.toBeInstanceOf(StorageFull);
  });

  it("tells the app the phone is full, and that it is not once a write to the same store lands", async () => {
    const heard: boolean[] = [];
    const stop = onStorageFull((isFull) => heard.push(isFull));
    full();
    await put("frames", FRAME).catch(() => undefined);
    // A small write elsewhere landing says nothing about room for a photograph.
    await put("device", PHONE);
    expect(heard).toEqual([true]);
    await put("frames", FRAME);
    expect(heard).toEqual([true, false]);
    stop();
  });

  it("passes any other failure on as it is", async () => {
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
      throw new DOMException("not cloneable", "DataCloneError");
    });
    await expect(put("frames", FRAME)).rejects.toMatchObject({ name: "DataCloneError" });
  });
});

describe("the wipe", () => {
  it("leaves no database behind", async () => {
    await put("device", PHONE);
    await wipe();
    const names = (await indexedDB.databases()).map((each) => each.name);
    expect(names).not.toContain(DATABASE);
  });

  it("finishes while the app itself still has the database open elsewhere", async () => {
    await put("device", PHONE);
    const racing = get("device", "device");
    await wipe();
    await racing;
    const names = (await indexedDB.databases()).map((each) => each.name);
    expect(names).not.toContain(DATABASE);
  });

  it("does not strand the sign-in on a connection that never lets go, and deletes once it does", async () => {
    await put("device", PHONE);
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
