// The technician API, faked in the browser, at the shapes `docs/openapi-tech.json`
// writes (apps/tech/src/api-schema.ts). No mm-api runs for these tests: the app
// is driven through its own client, so what is checked is the app's behaviour,
// not the backend's, which has its own suite.
//
// The people are the design's own invented ones. No real name, number or
// photograph is used anywhere.

import type { BrowserContext, Page, Route } from "@playwright/test";

export const ME = {
  name: "Imran Qureshi",
  first_name: "Imran",
  initials: "IQ",
  device: {
    device_id: "01000000-0000-7000-8000-000000000001",
    label: "Chrome on Android",
    enrolled_at: "2030-09-01T04:00:00.000Z",
  },
};

export const JOB_ID = "a0000000-0000-4000-8000-000000000001";
export const SECOND_JOB_ID = "a0000000-0000-4000-8000-000000000002";
export const LOCKED_JOB_ID = "a0000000-0000-4000-8000-000000000003";

/** Today's calendar date in India, as the app asks the backend for it. */
export function todayInIndia(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);
}

export function dayBefore(date: string): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
}

const at = (date: string, time: string) => `${date}T${time}:00.000Z`;

/** 6 pm in India on the day before the visit, when its address unlocks (src/policy/job-visibility.ts). */
const unlocksAt = (date: string) => at(dayBefore(date), "12:30");

export function jobsToday(date: string) {
  return [
    {
      id: JOB_ID,
      day: "today",
      date,
      starts_at: at(date, "04:00"),
      ends_at: at(date, "05:30"),
      window_label: "morning",
      type: "service",
      sector: "Sector 65",
      status: "scheduled",
      badge: "prepaid",
      unlocked: true,
      unlocks_at: unlocksAt(date),
    },
    {
      id: SECOND_JOB_ID,
      day: "today",
      date,
      starts_at: at(date, "06:00"),
      ends_at: at(date, "07:30"),
      window_label: "morning",
      type: "service",
      sector: "DLF Phase 4",
      status: "scheduled",
      badge: "credit",
      unlocked: true,
      unlocks_at: unlocksAt(date),
    },
    {
      id: LOCKED_JOB_ID,
      day: "later",
      date,
      starts_at: at(date, "08:30"),
      ends_at: at(date, "11:30"),
      window_label: "afternoon",
      type: "first_fit",
      sector: "Sector 43",
      status: "scheduled",
      badge: "prepaid",
      unlocked: false,
      unlocks_at: unlocksAt(date),
    },
  ];
}

const CHECKLIST = [
  { id: "piece_removed", label: "PLACEHOLDER Piece removed" },
  { id: "scalp_cleaned", label: "PLACEHOLDER Scalp cleaned" },
  { id: "piece_cleaned", label: "PLACEHOLDER Piece cleaned" },
];

const PARTIAL_REASONS = ["client_stopped_it", "piece_not_ready", "client_unwell", "more_time_needed"];

export interface Progress {
  checked_in_at: string | null;
  started_at: string | null;
  steps_done: string[];
  outcome: string | null;
}

export function card(date: string, progress: Progress) {
  const [first] = jobsToday(date);
  return {
    ...first,
    address: {
      line1: "Tower C, 14th floor",
      line2: null,
      locality: "Sector 65",
      city: "Gurgaon",
      pincode: "122018",
      lat: 28.39,
      lng: 77.07,
    },
    access_notes: "Gate code 4417 · visitor bay B",
    client: { name: "Rohit M.", mobile: "+919810000000", note: null },
    progress,
    steps: ["before_photos", "checklist", "consumables", "after_photos", "outcome"],
    checklist: CHECKLIST,
    partial_reasons: PARTIAL_REASONS,
  };
}

/** A job further out: time, type and sector only, as the day-before unlock leaves it. */
export function lockedCard(date: string) {
  const locked = jobsToday(date)[2];
  return {
    ...locked,
    address: null,
    access_notes: null,
    client: null,
    progress: { checked_in_at: null, started_at: null, steps_done: [], outcome: null },
    steps: ["before_photos", "checklist", "consumables", "piece", "after_photos", "outcome"],
    checklist: CHECKLIST,
    partial_reasons: PARTIAL_REASONS,
  };
}

export interface Write {
  readonly path: string;
  readonly eventId: string | null;
  readonly body: unknown;
}

export interface Fake {
  /** False stands for a basement: every call fails as it does with no signal. */
  online: boolean;
  /** Set to make the next write answer `409 superseded` with these fields. */
  supersede: readonly string[] | null;
  /** Set to make the no-show refuse with `425 too_early_to_close`, as it does before the wait runs. */
  tooEarly: boolean;
  /** What the check-in answers: pass, or a distance outside the radius. */
  checkIn: { passed: boolean; distance_m: number | null };
  /** How long the no-show wait runs from the check-in, in minutes. */
  waitMinutes: number;
  /** Every write that reached the API, in the order it arrived. */
  readonly writes: Write[];
  /** Every photograph PUT to an upload link, by its angle. */
  readonly photos: string[];
  /** What the job's card reports, which the fake moves on as writes land. */
  progress: Progress;
}

const accepted = (fake: Fake, eventId: string | null) => ({
  event_id: eventId ?? "",
  replayed: false,
  fsm_write_state: "pending",
  progress: fake.progress,
});

/**
 * Answers the technician API for one page. Anything not named here is a 404, so
 * a screen calling a route nobody agreed to fails the test rather than passing
 * quietly.
 *
 * `on` is the page, except where a service worker is running: a worker's own
 * calls reach browserContext.route() and not page.route(), so the offline tests
 * pass the context instead (e2e/tech/offline.e2e.ts).
 */
export async function fakeTech(page: Page, empty = false, on: Page | BrowserContext = page): Promise<Fake> {
  const today = todayInIndia();
  const fake: Fake = {
    online: true,
    supersede: null,
    tooEarly: false,
    checkIn: { passed: true, distance_m: 40 },
    waitMinutes: 15,
    writes: [],
    photos: [],
    progress: { checked_in_at: null, started_at: null, steps_done: [], outcome: null },
  };

  await on.route("**/api/tech/**", async (route: Route) => {
    if (!fake.online) return route.abort();
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    const eventId = route.request().headers()["x-client-event-id"] ?? null;

    // The photograph itself: PUT to the link the API handed out.
    if (method === "PUT" && path.startsWith("/api/tech/photos/")) {
      fake.photos.push(path.slice("/api/tech/photos/".length));
      return route.fulfill({ status: 204 });
    }

    if (method === "POST") {
      if (path === "/api/tech/auth/logout") return route.fulfill({ status: 204 });
      if (path.endsWith("/photos/upload-url")) {
        const body = route.request().postDataJSON() as { phase: string; angle: string };
        return route.fulfill({
          status: 201,
          json: {
            upload_url: `/api/tech/photos/${body.phase}-${body.angle}`,
            expires_at: new Date(Date.now() + 900_000).toISOString(),
          },
        });
      }

      const changed = fake.supersede;
      if (changed !== null) {
        return route.fulfill({
          status: 409,
          json: { error: { code: "superseded", request_id: "test", fields: [...changed] } },
        });
      }
      if (path.endsWith("/no-show") && fake.tooEarly) {
        return route.fulfill({
          status: 425,
          json: { error: { code: "too_early_to_close", request_id: "test" } },
        });
      }

      fake.writes.push({ path, eventId, body: route.request().postDataJSON() as unknown });

      if (path.endsWith("/checkin")) {
        const now = new Date();
        fake.progress = fake.checkIn.passed ? { ...fake.progress, checked_in_at: now.toISOString() } : fake.progress;
        return route.fulfill({
          status: 200,
          json: {
            passed: fake.checkIn.passed,
            distance_m: fake.checkIn.distance_m,
            radius_m: 200,
            checked_in_at: now.toISOString(),
            wait_ends_at: fake.checkIn.passed
              ? new Date(now.getTime() + fake.waitMinutes * 60_000).toISOString()
              : null,
            accepted: fake.checkIn.passed ? accepted(fake, eventId) : null,
          },
        });
      }
      if (path.endsWith("/start")) {
        fake.progress = { ...fake.progress, started_at: new Date().toISOString() };
        return route.fulfill({ status: 202, json: accepted(fake, eventId) });
      }
      if (path.endsWith("/no-show")) {
        fake.progress = { ...fake.progress, outcome: "no_show" };
        return route.fulfill({
          status: 200,
          json: {
            closed: true,
            wait_ends_at: new Date().toISOString(),
            case_id: "b0000000-0000-4000-8000-000000000001",
            accepted: accepted(fake, eventId),
          },
        });
      }
      const step = stepOf(path, route.request().postDataJSON() as { phase?: string } | null);
      if (step !== null) {
        fake.progress = { ...fake.progress, steps_done: [...fake.progress.steps_done, step] };
        if (step === "outcome") {
          const body = route.request().postDataJSON() as { outcome?: string };
          fake.progress = { ...fake.progress, outcome: body.outcome ?? "done" };
        }
        return route.fulfill({ status: 202, json: accepted(fake, eventId) });
      }
      return route.fulfill({ status: 404, json: { error: { code: "not_found", request_id: "test" } } });
    }

    if (path === "/api/tech/me") return route.fulfill({ json: ME });
    if (path === "/api/tech/jobs") {
      const date = url.searchParams.get("date") ?? "";
      const jobs = date === today && !empty ? jobsToday(date) : [];
      return route.fulfill({ json: { date, jobs } });
    }
    if (path === "/api/tech/pieces/lookup") {
      return route.fulfill({
        json: {
          piece: {
            piece_code: url.searchParams.get("code") ?? "",
            base: "PLACEHOLDER_STANDARD",
            supplier_lot: "LOT-4417",
            fitted_at: null,
            replacement_due_at: null,
            failed_at: null,
            failure_reason: null,
          },
          belongs_to_this_job: true,
        },
      });
    }
    if (path === `/api/tech/jobs/${JOB_ID}`) return route.fulfill({ json: card(today, fake.progress) });
    if (path === `/api/tech/jobs/${LOCKED_JOB_ID}`) return route.fulfill({ json: lockedCard(today) });
    return route.fulfill({ status: 404, json: { error: { code: "not_found", request_id: "test" } } });
  });

  return fake;
}

/** The job event a POST stands for, so the fake's progress moves as the real one does. */
function stepOf(path: string, body: { phase?: string } | null): string | null {
  if (path.endsWith("/photos")) return body?.phase === "after" ? "after_photos" : "before_photos";
  for (const step of ["checklist", "consumables", "piece", "outcome"]) {
    if (path.endsWith(`/${step}`)) return step;
  }
  return null;
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

/** The phone's position, so board B5's check-in can run without a real fix. */
export async function atTheDoor(page: Page, lat = 28.39, lng = 77.07): Promise<void> {
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({ latitude: lat, longitude: lng });
}
