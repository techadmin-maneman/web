// A database as the technician app's first release made it, at version 1, holding records in one of its stores: what
// the app's upgrades (apps/tech/src/store/upgrades.ts) find on a phone that has not opened a newer build.

import { DATABASE } from "../../../apps/tech/src/store/db.ts";

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
        reject(new Error("could not seed the first release's store"));
      };
    };
  });
}
