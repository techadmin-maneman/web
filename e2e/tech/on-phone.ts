// What a test reads off the technician's phone (./fixtures.ts): what its stores hold for a job, what waits to be
// sent, and the page as it scrolls.

import type { Page } from "@playwright/test";
import { type Step, JOB_ID } from "./fixtures.ts";

/** Whether anything scrolls but a screen's own body: the page, or the column the screens sit in. */
export function pageScrolls(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const column = document.getElementById("root");
    const pageHeight = document.scrollingElement?.scrollHeight ?? 0;
    return pageHeight > window.innerHeight || (column !== null && column.scrollHeight > column.clientHeight);
  });
}

/** Everything the phone is holding in its own store, read from the page. */
export function heldOnPhone(
  page: Page,
): Promise<{ outbox: number; frames: number; frameSizes: number[]; smallSizes: number[] }> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("mm-tech");
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(new Error("no store"));
      };
    });

    const read = <T>(store: string) =>
      new Promise<T[]>((resolve) => {
        const request = db.transaction(store, "readonly").objectStore(store).getAll() as IDBRequest<T[]>;
        request.onsuccess = () => {
          resolve(request.result);
        };
      });

    const outbox = await read<unknown>("outbox");
    const frames = await read<{ frame: Blob; small?: Blob }>("frames");
    return {
      outbox: outbox.length,
      frames: frames.length,
      frameSizes: frames.map((kept) => kept.frame.size),
      smallSizes: frames.map((kept) => kept.small?.size ?? 0),
    };
  });
}

/** One of the phone's own device records, by its key, as JSON; null when it holds none. */
export function deviceRecordOnPhone(page: Page, key: string): Promise<string | null> {
  return page.evaluate(async (wanted) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("mm-tech");
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(new Error("no store"));
      };
    });
    return new Promise<string | null>((resolve) => {
      const request = db.transaction("device", "readonly").objectStore("device").get(wanted) as IDBRequest<unknown>;
      request.onsuccess = () => {
        resolve(request.result === undefined ? null : JSON.stringify(request.result));
      };
    });
  }, key);
}

/** The angles of the frames the phone holds, in the order the store keeps them. */
export function anglesOnPhone(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("mm-tech");
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(new Error("no store"));
      };
    });

    const frames = await new Promise<{ angle: string }[]>((resolve) => {
      const request = db.transaction("frames", "readonly").objectStore("frames").getAll() as IDBRequest<
        { angle: string }[]
      >;
      request.onsuccess = () => {
        resolve(request.result);
      };
    });
    db.close();
    return frames.map((frame) => frame.angle);
  });
}

/** Whether the phone still holds its store at all: a wipe deletes the whole database. */
export async function storeOnPhone(page: Page): Promise<boolean> {
  const names = await page.evaluate(() => indexedDB.databases().then((each) => each.map((one) => one.name)));
  return names.includes("mm-tech");
}

/** The stores of what the phone keeps of the jobs (apps/tech/src/store/db.ts). */
const JOB_STORES = ["days", "cards", "arrivals", "closures", "starts"] as const;
/**
 * What the phone keeps of the jobs, sorted, each as its store and key: its days ("days:<date>"), its cards
 * ("cards:<job>"), and each job's arrival, close-out and start at check-in.
 */

export function keptOnPhone(page: Page): Promise<string[]> {
  return page.evaluate(async (stores) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("mm-tech");
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(new Error("no store"));
      };
    });

    const kept: string[] = [];
    for (const name of stores) {
      const keys = await new Promise<IDBValidKey[]>((resolve) => {
        const request = db.transaction(name, "readonly").objectStore(name).getAllKeys();
        request.onsuccess = () => {
          resolve(request.result);
        };
      });
      kept.push(...keys.filter((key) => typeof key === "string").map((key) => `${name}:${key}`));
    }
    db.close();
    return kept.sort();
  }, JOB_STORES);
}

/** Puts records straight into what the phone keeps of the jobs, by store, as an older day's work would have left them. */
export async function leftOnPhone(
  page: Page,
  records: Partial<Record<(typeof JOB_STORES)[number], readonly object[]>>,
): Promise<void> {
  await page.evaluate(async (kept) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("mm-tech");
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(new Error("no store"));
      };
    });
    await new Promise<void>((resolve) => {
      const transaction = db.transaction(Object.keys(kept), "readwrite");
      for (const [name, list] of Object.entries(kept)) {
        for (const record of list) transaction.objectStore(name).put(record);
      }
      transaction.oncomplete = () => {
        resolve();
      };
    });
    db.close();
  }, records);
}

/** A write of the first job's, as the phone's outbox keeps it: refused, or waiting behind one. */
export interface LeftWrite {
  readonly id: string;
  readonly kind: Step;
  readonly route: string;
  readonly body: unknown;
  readonly refused?: { readonly note: string; readonly fields: readonly string[] };
}

/** Puts writes straight into the phone's outbox, in order, as a refusal or an older build would have left them. */
export async function queuedOnPhone(page: Page, writes: readonly LeftWrite[]): Promise<void> {
  await page.evaluate(
    async ({ job, left }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("mm-tech");
        request.onsuccess = () => {
          resolve(request.result);
        };
        request.onerror = () => {
          reject(new Error("no store"));
        };
      });
      await new Promise<void>((resolve) => {
        const transaction = db.transaction("outbox", "readwrite");
        for (const write of left) {
          transaction.objectStore("outbox").add({
            id: write.id,
            job_id: job,
            kind: write.kind,
            path: `/tech/jobs/${job}/${write.route}`,
            body: write.body,
            queued_at: Date.now(),
            state: write.refused === undefined ? "waiting" : "refused",
            note: write.refused?.note ?? null,
            fields: write.refused?.fields ?? [],
          });
        }
        transaction.oncomplete = () => {
          resolve();
        };
      });
      db.close();
    },
    { job: JOB_ID, left: writes },
  );
}

/** The phone's position, so the design's check-in can run without a real fix. */
export async function atTheDoor(page: Page, lat = 28.39, lng = 77.07): Promise<void> {
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({ latitude: lat, longitude: lng });
}
