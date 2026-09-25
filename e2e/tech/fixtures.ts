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

const CHALLENGE_ID = "c0000000-0000-4000-8000-000000000001";

export const JOB_ID = "a0000000-0000-4000-8000-000000000001";
export const SECOND_JOB_ID = "a0000000-0000-4000-8000-000000000002";
export const LOCKED_JOB_ID = "a0000000-0000-4000-8000-000000000003";
export const TOMORROW_JOB_ID = "a0000000-0000-4000-8000-000000000004";

/** Today's calendar date in India, as the app asks the backend for it. */
export function todayInIndia(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);
}

export function dayBefore(date: string): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
}

export function dayAfter(date: string): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
}

const at = (date: string, time: string) => `${date}T${time}:00.000Z`;

/** 6 pm in India on the day before the visit, when its address unlocks (src/policy/job-visibility.ts). */
const unlocksAt = (date: string) => at(dayBefore(date), "12:30");

/** The slots each type takes (src/config/scheduling.ts). */
const SLOTS: Readonly<Record<string, number>> = { consultation: 1, service: 1, replacement: 1.5, first_fit: 2 };

export function jobsToday(date: string, type = "service") {
  return [
    {
      id: JOB_ID,
      day: "today",
      date,
      starts_at: at(date, "04:00"),
      ends_at: at(date, "05:30"),
      window_label: "morning",
      type,
      sector: "Sector 65",
      status: "scheduled",
      badge: "prepaid",
      slots: SLOTS[type] ?? 1,
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
      slots: 1,
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
      slots: 2,
      unlocked: false,
      unlocks_at: unlocksAt(date),
    },
  ];
}

/** Tomorrow's one job, unlocked since 6 pm today: its card is open, and its door is not. */
export function jobsTomorrow(today: string) {
  const date = dayAfter(today);
  return [
    {
      id: TOMORROW_JOB_ID,
      day: "tomorrow",
      date,
      starts_at: at(date, "04:30"),
      ends_at: at(date, "06:00"),
      window_label: "morning",
      type: "service",
      sector: "Sector 50",
      status: "scheduled",
      badge: "free",
      slots: 1,
      unlocked: true,
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

/** The API's piece label (src/config/pieces.ts), which it refuses a write for. */
const PIECE_LABEL = /^MM-[A-Z0-9]{2,6}-\d{2,8}-[A-Z]$/;

export interface Progress {
  checked_in_at: string | null;
  wait_ends_at: string | null;
  distance_m: number | null;
  started_at: string | null;
  steps_done: string[];
  outcome: string | null;
}

export const NOTHING_DONE: Progress = {
  checked_in_at: null,
  wait_ends_at: null,
  distance_m: null,
  started_at: null,
  steps_done: [],
  outcome: null,
};

export interface Piece {
  readonly piece_code: string;
  readonly base: string | null;
  readonly supplier_lot: string | null;
  readonly fitted_at: string | null;
  readonly replacement_due_at: string | null;
  readonly failed_at: string | null;
  readonly failure_reason: string | null;
}

/** Rohit's piece on his head today, fitted in July. */
export const ROHITS_PIECE: Piece = {
  piece_code: "MM-STD-4417-B",
  base: "PLACEHOLDER_STANDARD",
  supplier_lot: "LOT-4417",
  fitted_at: "2030-07-02",
  replacement_due_at: "2030-12-29",
  failed_at: null,
  failure_reason: null,
};

const stepsFor = (type: string) =>
  type === "replacement" || type === "first_fit"
    ? ["before_photos", "checklist", "consumables", "piece", "after_photos", "outcome"]
    : ["before_photos", "checklist", "consumables", "after_photos", "outcome"];

export interface CardOptions {
  readonly pin?: boolean;
  readonly type?: string;
  readonly waitMinutes?: number;
  readonly pieces?: readonly Piece[];
  readonly lastVisit?: boolean;
  readonly reminderDelivered?: string | null;
  /** Parts of the address the client filled in beyond the fixture's two lines: flat, floor, tower, building, landmark. */
  readonly address?: Readonly<Record<string, string | null>>;
}

export function card(date: string, progress: Progress, options: CardOptions = {}) {
  const type = options.type ?? "service";
  const [first] = jobsToday(date, type);
  return {
    ...first,
    address: {
      line1: "Tower C, 14th floor",
      line2: null,
      building: null,
      tower: null,
      floor: null,
      flat: null,
      landmark: null,
      locality: "Sector 65",
      city: "Gurgaon",
      pincode: "122018",
      // An address the client typed rather than chose carries no coordinate (ADR 0054).
      lat: options.pin === false ? null : 28.39,
      lng: options.pin === false ? null : 77.07,
      ...options.address,
    },
    access_notes: "Gate code 4417 · visitor bay B",
    client: { name: "Rohit M.", mobile: "+919810000000", note: null },
    progress,
    no_show_wait_min: options.waitMinutes ?? 15,
    pieces: [...(options.pieces ?? [])],
    last_visit:
      options.lastVisit === true
        ? { date: "2030-08-22", technician: "Imran", photo_url: `/api/tech/jobs/${JOB_ID}/last-visit-photo` }
        : null,
    reminder: options.reminderDelivered === undefined ? null : { delivered_at: options.reminderDelivered },
    steps: stepsFor(type),
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
    progress: NOTHING_DONE,
    no_show_wait_min: 15,
    pieces: null,
    last_visit: null,
    reminder: null,
    steps: stepsFor("first_fit"),
    checklist: CHECKLIST,
    partial_reasons: PARTIAL_REASONS,
  };
}

/** Tomorrow's card: unlocked, so the address is there, and on a day that is not today. */
function tomorrowCard(today: string) {
  const [job] = jobsTomorrow(today);
  return { ...card(today, NOTHING_DONE), ...job };
}

export interface Write {
  readonly path: string;
  readonly eventId: string | null;
  /** The job's start as the phone held it when it queued the write. */
  readonly startsAt: string | null;
  readonly body: unknown;
}

export interface Fake {
  /** False stands for a basement: every call fails as it does with no signal. */
  online: boolean;
  /** False until a code is verified: the API has no session for this phone, and every call but the sign-in's is a 401. */
  signedIn: boolean;
  /** True once ops revoke the phone: every call is a 401 `device_revoked`. */
  revoked: boolean;
  /** True makes the next code the phone checks one the API has closed, a `410`. */
  codeClosed: boolean;
  /** Every mobile number a code was asked for, in order. */
  readonly codesSent: string[];
  /** True makes the day's list arrive in a shape the app cannot draw, as a broken release might send it. */
  malformed: boolean;
  /** Set to make the next write answer `409 superseded` with these fields. */
  supersede: readonly string[] | null;
  /**
   * True once ops have given the job to someone else: its card and its upload
   * links answer 404, as the API answers for a job that is not this
   * technician's, and a write answers `409 superseded` naming the technician.
   */
  moved: boolean;
  /**
   * Set to move the job to another time: a write that holds any other answers
   * `409 superseded`, field time. The card goes on answering the old time, as
   * the copy the phone holds does until it asks again.
   */
  movedTo: string | null;
  /** Set to make the no-show refuse with `425 too_early_to_close`, as it does before the wait runs. */
  tooEarly: boolean;
  /** What the check-in answers: pass, or a distance outside the radius. */
  checkIn: { passed: boolean; distance_m: number | null };
  /** How long the no-show wait runs from the check-in, in minutes. */
  waitMinutes: number;
  /** False for an address saved by typing, which has no coordinate for Navigate to take. */
  pin: boolean;
  /** The first job's type: a replacement or a first fit has the piece step. */
  type: string;
  /** The client's pieces on the card. */
  pieces: Piece[];
  /** Parts of the address beyond the fixture's two lines. */
  address: Record<string, string | null>;
  /** Whether the client has a last visit with an after photograph. */
  lastVisit: boolean;
  /** The day-before WhatsApp: undefined when none was sent, null when it never arrived. */
  reminderDelivered: string | null | undefined;
  /** True puts one unlocked job on tomorrow's list. */
  tomorrow: boolean;
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

const refusal = (status: number, code: string, fields: readonly string[] = []) => ({
  status,
  json: { error: { code, request_id: "test", fields: [...fields] } },
});

/** A 1×1 grey PNG: the last visit's photograph, which is nobody's. */
const LAST_VISIT_PHOTO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgAB4iG8MwAAAABJRU5ErkJggg==",
  "base64",
);

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
    signedIn: true,
    revoked: false,
    codeClosed: false,
    codesSent: [],
    malformed: false,
    supersede: null,
    moved: false,
    movedTo: null,
    tooEarly: false,
    checkIn: { passed: true, distance_m: 40 },
    waitMinutes: 15,
    pin: true,
    type: "service",
    pieces: [],
    address: {},
    lastVisit: false,
    reminderDelivered: undefined,
    tomorrow: false,
    writes: [],
    photos: [],
    progress: NOTHING_DONE,
  };

  const jobCard = () =>
    card(today, fake.progress, {
      pin: fake.pin,
      type: fake.type,
      waitMinutes: fake.waitMinutes,
      pieces: fake.pieces,
      lastVisit: fake.lastVisit,
      reminderDelivered: fake.reminderDelivered,
      address: fake.address,
    });

  await on.route("**/api/tech/**", async (route: Route) => {
    if (!fake.online) return route.abort();
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    const headers = route.request().headers();
    const eventId = headers["x-client-event-id"] ?? null;
    const startsAt = headers["x-job-starts-at"] ?? null;

    // The sign-in: a code for any number, and any six digits right unless the code was closed.
    if (method === "POST" && path === "/api/tech/auth/otp") {
      const body = route.request().postDataJSON() as { mobile: string };
      fake.codesSent.push(body.mobile);
      return route.fulfill({ status: 202, json: { challenge_id: CHALLENGE_ID, expires_in_s: 600 } });
    }
    if (method === "POST" && path === "/api/tech/auth/verify") {
      if (fake.codeClosed) return route.fulfill(refusal(410, "code_expired"));
      fake.signedIn = true;
      return route.fulfill({ json: { verified: true, first_name: ME.first_name, device_id: ME.device.device_id } });
    }
    if (fake.revoked) return route.fulfill(refusal(401, "device_revoked"));
    if (!fake.signedIn) return route.fulfill(refusal(401, "session_required"));

    // The photograph itself: PUT to the link the API handed out.
    if (method === "PUT" && path.startsWith("/api/tech/photos/")) {
      if (fake.moved) return route.fulfill(refusal(404, "not_found"));
      fake.photos.push(path.slice("/api/tech/photos/".length));
      return route.fulfill({ status: 204 });
    }

    if (method === "POST") {
      if (path === "/api/tech/auth/logout") return route.fulfill({ status: 204 });
      if (path.endsWith("/photos/upload-url")) {
        if (fake.moved) return route.fulfill(refusal(404, "not_found"));
        const body = route.request().postDataJSON() as { phase: string; angle: string };
        return route.fulfill({
          status: 201,
          json: {
            upload_url: `/api/tech/photos/${body.phase}-${body.angle}`,
            expires_at: new Date(Date.now() + 900_000).toISOString(),
          },
        });
      }

      if (fake.moved) return route.fulfill(refusal(409, "superseded", ["technician"]));
      if (fake.movedTo !== null && startsAt !== null && startsAt !== fake.movedTo) {
        return route.fulfill(refusal(409, "superseded", ["time"]));
      }
      const changed = fake.supersede;
      if (changed !== null) return route.fulfill(refusal(409, "superseded", changed));
      if (path.endsWith("/no-show") && fake.tooEarly) return route.fulfill(refusal(425, "too_early_to_close"));

      const body = route.request().postDataJSON() as { piece_code?: string } | null;
      if (path.endsWith("/piece") && !PIECE_LABEL.test(body?.piece_code ?? "")) {
        return route.fulfill(refusal(400, "invalid_request", ["piece_code"]));
      }
      fake.writes.push({ path, eventId, startsAt, body });

      if (path.endsWith("/checkin")) {
        const now = new Date();
        const waitEnds = new Date(now.getTime() + fake.waitMinutes * 60_000).toISOString();
        if (fake.checkIn.passed) {
          fake.progress = {
            ...fake.progress,
            checked_in_at: now.toISOString(),
            wait_ends_at: waitEnds,
            distance_m: fake.checkIn.distance_m,
          };
        }
        return route.fulfill({
          status: 200,
          json: {
            passed: fake.checkIn.passed,
            distance_m: fake.checkIn.distance_m,
            radius_m: 200,
            checked_in_at: now.toISOString(),
            wait_ends_at: fake.checkIn.passed ? waitEnds : null,
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
      const step = stepOf(path, body as { phase?: string } | null);
      if (step !== null) {
        fake.progress = { ...fake.progress, steps_done: [...fake.progress.steps_done, step] };
        if (step === "outcome") {
          const outcome = (body as { outcome?: string } | null)?.outcome ?? "done";
          fake.progress = { ...fake.progress, outcome };
        }
        return route.fulfill({ status: 202, json: accepted(fake, eventId) });
      }
      return route.fulfill(refusal(404, "not_found"));
    }

    if (path === "/api/tech/me") return route.fulfill({ json: ME });
    if (path === "/api/tech/jobs") {
      const date = url.searchParams.get("date") ?? "";
      if (fake.malformed) return route.fulfill({ json: { date, jobs: null } });
      if (date === today) return route.fulfill({ json: { date, jobs: empty ? [] : jobsToday(date, fake.type) } });
      if (date === dayAfter(today) && fake.tomorrow)
        return route.fulfill({ json: { date, jobs: jobsTomorrow(today) } });
      return route.fulfill({ json: { date, jobs: [] } });
    }
    if (path === "/api/tech/pieces/lookup") {
      const code = url.searchParams.get("code") ?? "";
      if (!PIECE_LABEL.test(code)) return route.fulfill(refusal(404, "not_found"));
      return route.fulfill({
        json: {
          piece: { ...ROHITS_PIECE, piece_code: code },
          belongs_to_this_job: code === ROHITS_PIECE.piece_code,
        },
      });
    }
    if (path === `/api/tech/jobs/${JOB_ID}/last-visit-photo`) {
      if (fake.moved || !fake.lastVisit) return route.fulfill(refusal(404, "not_found"));
      return route.fulfill({ contentType: "image/png", body: LAST_VISIT_PHOTO });
    }
    if (path === `/api/tech/jobs/${JOB_ID}`) {
      return fake.moved ? route.fulfill(refusal(404, "not_found")) : route.fulfill({ json: jobCard() });
    }
    if (path === `/api/tech/jobs/${LOCKED_JOB_ID}`) return route.fulfill({ json: lockedCard(today) });
    if (path === `/api/tech/jobs/${TOMORROW_JOB_ID}` && fake.tomorrow) {
      return route.fulfill({ json: tomorrowCard(today) });
    }
    return route.fulfill(refusal(404, "not_found"));
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

/** The keys of what the phone keeps of the API, sorted: its days, its cards, and each job's arrival and close-out. */
export function keptOnPhone(page: Page): Promise<string[]> {
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
    const keys = await new Promise<IDBValidKey[]>((resolve) => {
      const request = db.transaction("jobs", "readonly").objectStore("jobs").getAllKeys();
      request.onsuccess = () => {
        resolve(request.result);
      };
    });
    db.close();
    return keys.map(String).sort();
  });
}

/** Puts records straight into what the phone keeps, as an older day's work would have left them. */
export async function leftOnPhone(page: Page, records: readonly object[]): Promise<void> {
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
      const transaction = db.transaction("jobs", "readwrite");
      for (const record of kept) transaction.objectStore("jobs").put(record);
      transaction.oncomplete = () => {
        resolve();
      };
    });
    db.close();
  }, records);
}

/** The phone's position, so board B5's check-in can run without a real fix. */
export async function atTheDoor(page: Page, lat = 28.39, lng = 77.07): Promise<void> {
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({ latitude: lat, longitude: lng });
}
