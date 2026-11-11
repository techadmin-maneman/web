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

/** A database as the build before jobs carried their arrival window left it, at version 6, holding a day and cards. */
export function sixthRelease(kept: {
  readonly days: readonly object[];
  readonly cards: readonly object[];
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 6);
    request.onupgradeneeded = (event) => {
      const upgrade = request.transaction;
      if (upgrade === null) return;
      for (const step of UPGRADES.slice(event.oldVersion, 6)) step(request.result, upgrade);
    };
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(["days", "cards"], "readwrite");
      for (const day of kept.days) transaction.objectStore("days").put(day);
      for (const card of kept.cards) transaction.objectStore("cards").put(card);
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onabort = () => {
        reject(new Error("could not seed the sixth release’s days and cards"));
      };
    };
  });
}

/** A database as the build before the head was measured in inches left it, at version 7, holding these records. */
export function seventhRelease(kept: {
  readonly cards: readonly object[];
  readonly device: readonly object[];
  readonly outbox: readonly object[];
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 7);
    request.onupgradeneeded = (event) => {
      const upgrade = request.transaction;
      if (upgrade === null) return;
      for (const step of UPGRADES.slice(event.oldVersion, 7)) step(request.result, upgrade);
    };
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(["cards", "device", "outbox"], "readwrite");
      for (const card of kept.cards) transaction.objectStore("cards").put(card);
      for (const record of kept.device) transaction.objectStore("device").put(record);
      for (const queued of kept.outbox) transaction.objectStore("outbox").put(queued);
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onabort = () => {
        reject(new Error("could not seed the seventh release’s records"));
      };
    };
  });
}

/** A database as the build before a day's rows carried their drive left it, at version 8, holding these days. */
export function eighthRelease(days: readonly object[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 8);
    request.onupgradeneeded = (event) => {
      const upgrade = request.transaction;
      if (upgrade === null) return;
      for (const step of UPGRADES.slice(event.oldVersion, 8)) step(request.result, upgrade);
    };
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction("days", "readwrite");
      for (const day of days) transaction.objectStore("days").put(day);
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onabort = () => {
        reject(new Error("could not seed the eighth release’s days"));
      };
    };
  });
}

/** A database as the build before the card carried the client's alerts left it, at version 9, holding these cards. */
export function ninthRelease(cards: readonly object[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 9);
    request.onupgradeneeded = (event) => {
      const upgrade = request.transaction;
      if (upgrade === null) return;
      for (const step of UPGRADES.slice(event.oldVersion, 9)) step(request.result, upgrade);
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
        reject(new Error("could not seed the ninth release’s cards"));
      };
    };
  });
}

/**
 * A database as the build before the card carried an ask to reschedule left it, at version 11, with these cards and,
 * where given, who was signed in.
 */
export function eleventhRelease(cards: readonly object[], me: object | null = null): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 11);
    request.onupgradeneeded = (event) => {
      const upgrade = request.transaction;
      if (upgrade === null) return;
      for (const step of UPGRADES.slice(event.oldVersion, 11)) step(request.result, upgrade);
    };
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(["cards", "device"], "readwrite");
      for (const card of cards) transaction.objectStore("cards").put(card);
      if (me !== null) transaction.objectStore("device").put({ key: "me", me });
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onabort = () => {
        reject(new Error("could not seed the eleventh release’s records"));
      };
    };
  });
}

/** A database as the build before the card carried the steps ops sent back left it, at version 10, with these cards. */
export function tenthRelease(cards: readonly object[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 10);
    request.onupgradeneeded = (event) => {
      const upgrade = request.transaction;
      if (upgrade === null) return;
      for (const step of UPGRADES.slice(event.oldVersion, 10)) step(request.result, upgrade);
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
        reject(new Error("could not seed the tenth release’s cards"));
      };
    };
  });
}
