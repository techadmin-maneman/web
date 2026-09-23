// The technician API, faked in the browser. P2-M4's routes are being built on
// another branch, so these tests answer them here, at the names
// `docs/prompts/phase2-backend.md` writes (apps/tech/src/routes.ts).
//
// The people are the design's own invented ones. No real name, number or
// photograph is used anywhere.

import type { Page, Route } from "@playwright/test";

export const ME = {
  technician: { name: "Imran Qureshi", initials: "IQ" },
  device: { id: "01000000-0000-7000-8000-000000000001", label: "Chrome on Android" },
};

export const JOB_ID = "a0000000-0000-4000-8000-000000000001";
const SECOND_JOB_ID = "a0000000-0000-4000-8000-000000000002";
const LOCKED_JOB_ID = "a0000000-0000-4000-8000-000000000003";

/** Today's calendar date in India, as the app asks the backend for it. */
export function todayInIndia(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);
}

export function dayAfter(date: string): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
}

const at = (date: string, time: string) => `${date}T${time}:00.000Z`;

export function jobsToday(date: string) {
  return [
    {
      id: JOB_ID,
      starts_at: at(date, "04:00"),
      slots: 1,
      type: "service",
      badge: "prepaid",
      client_name: "Rohit M.",
      sector: "Sector 65",
      distance_km: 3.1,
      locked: false,
    },
    {
      id: SECOND_JOB_ID,
      starts_at: at(date, "06:00"),
      slots: 1,
      type: "service",
      badge: "credit",
      client_name: "Vikram S.",
      sector: "DLF Phase 4",
      distance_km: 5.4,
      locked: false,
    },
    {
      id: LOCKED_JOB_ID,
      starts_at: at(date, "08:30"),
      slots: 2,
      type: "first_fit",
      badge: "prepaid",
      client_name: "Sanjay B.",
      sector: "Sector 43",
      distance_km: 7.2,
      locked: true,
    },
  ];
}

export function card(date: string) {
  const [first] = jobsToday(date);
  return {
    ...first,
    address: { line: "Sector 65, Gurgaon 122018", access_notes: "Gate code 4417 · visitor bay B" },
    spec: [
      { key: "Tier", value: "Standard" },
      { key: "Base", value: "Mono" },
      { key: "Template", value: "RM-4417-v2" },
    ],
    last_visit: null,
    started_at: null,
  };
}

/** A job further out: time, type and sector only, as the backend's day-before unlock leaves it. */
export function lockedCard(date: string) {
  const locked = jobsToday(date)[2];
  return { ...locked, address: null, spec: [], last_visit: null, started_at: null };
}

export interface Write {
  readonly path: string;
  readonly eventId: string | null;
  readonly body: unknown;
}

export interface Fake {
  /** False stands for a basement: every call fails as it does with no signal. */
  online: boolean;
  /** Set to make the next write answer `409 superseded` with these words. */
  supersede: string | null;
  /** Every write that reached the API, in the order it arrived. */
  readonly writes: Write[];
}

/**
 * Answers the technician API for one page. Anything not named here is a 404, so
 * a screen calling a route nobody agreed to fails the test rather than passing
 * quietly.
 */
export async function fakeTech(page: Page, empty = false): Promise<Fake> {
  const today = todayInIndia();
  const fake: Fake = { online: true, supersede: null, writes: [] };

  await page.route("**/api/tech/**", async (route: Route) => {
    if (!fake.online) return route.abort();
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();

    if (method === "POST") {
      if (path === "/api/tech/auth/logout") return route.fulfill({ status: 204 });
      const message = fake.supersede;
      if (message !== null) {
        return route.fulfill({ status: 409, json: { error: { code: "superseded", message } } });
      }
      fake.writes.push({
        path,
        eventId: route.request().headers()["x-client-event-id"] ?? null,
        body: route.request().postDataJSON() as unknown,
      });
      return route.fulfill({ status: 204 });
    }

    if (path === "/api/tech/me") return route.fulfill({ json: ME });
    if (path === "/api/tech/jobs") {
      const date = url.searchParams.get("date") ?? "";
      const jobs = date === today && !empty ? jobsToday(date) : [];
      return route.fulfill({ json: { date, jobs } });
    }
    if (path === `/api/tech/jobs/${JOB_ID}`) return route.fulfill({ json: card(today) });
    if (path === `/api/tech/jobs/${LOCKED_JOB_ID}`) return route.fulfill({ json: lockedCard(today) });
    return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "No such route." } } });
  });

  return fake;
}

/** Everything the phone is holding in its own store, read from the page. */
export function heldOnPhone(page: Page): Promise<{ outbox: number; frames: number; frameSizes: number[] }> {
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
    const frames = await read<{ frame: Blob }>("frames");
    return { outbox: outbox.length, frames: frames.length, frameSizes: frames.map((kept) => kept.frame.size) };
  });
}
