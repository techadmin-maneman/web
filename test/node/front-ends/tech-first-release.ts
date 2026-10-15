// A database as an earlier release of the technician app left it, holding records in one of its stores: what the
// app's upgrades (apps/tech/src/store/upgrades.ts) find on a phone that has not opened a newer build.

import { DATABASE } from "../../../apps/tech/src/store/db.ts";
import { UPGRADES } from "../../../apps/tech/src/store/upgrades.ts";

export function firstRelease(records: readonly object[], name: "jobs" | "outbox" = "jobs"): Promise<void> {
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
      for (const record of records) transaction.objectStore(name).put(record);
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onabort = () => {
        reject(new Error("could not seed the first release’s store"));
      };
    };
  });
}

/** A database as the build before the lost reasons left it, at version 3, holding these cards. */
export function thirdRelease(cards: readonly object[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 3);
    request.onupgradeneeded = (event) => {
      const upgrade = request.transaction;
      if (upgrade === null) return;
      for (const step of UPGRADES.slice(event.oldVersion, 3)) step(request.result, upgrade);
    };
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction("cards", "readwrite");
      for (const card of cards) transaction.objectStore("cards").put(card);
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onabort = () => {
        reject(new Error("could not seed the third release’s cards"));
      };
    };
  });
}
