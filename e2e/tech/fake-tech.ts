// The technician API, faked in the browser (./fixtures.ts): each call answered from the day's jobs and cards, each
// write kept, and a refusal where mm-api would refuse.

import type { Route, Page, BrowserContext } from "@playwright/test";
import { randomUUID } from "crypto";
// The API's own rule, so the fake cannot drift from it: the piece label it refuses a write for.
import { isPieceCode } from "../../src/config/pieces.ts";
import { assertInContract } from "../contract.ts";
import {
  type VisitType,
  type Card,
  type Piece,
  type HairProfile,
  type AddressParts,
  type Progress,
  type TechReply,
  CHECKLIST,
  NOTHING_DONE,
  card,
  todayInIndia,
  CHALLENGE_ID,
  ME,
  jobsToday,
  dayAfter,
  jobsTomorrow,
  ROHITS_PIECE,
  JOB_ID,
  LOCKED_JOB_ID,
  lockedCard,
  TOMORROW_JOB_ID,
  tomorrowCard,
  type Step,
} from "./fixtures.ts";

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
  /** True once ops switch the technician off: every call but the sign-in's is a 401 `technician_inactive`. */
  switchedOff: boolean;
  /** True makes the next code the phone checks one the API has closed, a `410`. */
  codeClosed: boolean;
  /** Every mobile number a code was asked for, in order. */
  readonly codesSent: string[];
  /** True makes the day's list arrive in a shape the app cannot draw, as a broken release might send it. */
  malformed: boolean;
  /** Set to make the next write answer `409 superseded` with these fields. */
  supersede: readonly string[] | null;
  /** Set with `supersede` to name whom the job went to, and when, as the API does (open point 92). */
  wentTo: WentTo;
  /**
   * True once ops have given the job to someone else: its card and a
   * photograph's PUT answer 404, as the API answers for a job that is not this
   * technician's, and a write or an upload link answers `409 superseded`
   * naming the field, and whom the job went to where `wentTo` says.
   */
  moved: boolean;
  /**
   * Set to move the job to another time: a write that holds any other answers
   * `409 superseded`, field time, and the card answers the new time, as the
   * API does once the phone asks again.
   */
  movedTo: string | null;
  /** Set to make the no-show refuse with `425 too_early_to_close`, as it does before the wait runs. */
  tooEarly: boolean;
  /** Set to a photograph's slot, as `before-top`, to refuse its file with `422 photo_invalid_file`, as an empty one is. */
  refusedPhoto: string | null;
  /** What the check-in answers: pass, or a distance outside the radius. */
  checkIn: { passed: boolean; distance_m: number | null };
  /** How long the no-show wait runs from the check-in, in whole minutes, as ops set it. */
  waitMinutes: number;
  /** The card's booked start, for a test whose wait depends on it; the fixture's 9:30 am when null. */
  startsAt: string | null;
  /**
   * Set to answer a passing check-in with only this many milliseconds of the wait
   * left, so a test need not wait whole minutes. The API answers so for a check-in
   * the phone made earlier and sent late, which keeps its claimed time (ADR 0065).
   */
  waitLeftMs: number | null;
  /** False for an address saved by typing, which has no coordinate for Navigate to take. */
  pin: boolean;
  /** The first job's type: a replacement or a first fit has the piece step. */
  type: VisitType;
  /** True makes the first job a consultation and fit in one visit. */
  oneVisit: boolean;
  /** The discount code already on the one visit, or none. */
  discountCode: Card["discount_code"];
  /** The service the first job was sold as, or none. */
  service: Card["service"];
  /** What the one visit's client decided, as its piece step landed; the fake records it as the step lands. */
  clientChoice: Card["client_choice"];
  /** The client's pieces on the card. */
  pieces: Piece[];
  /** The client's hair profile on the card, or none recorded. */
  profile: HairProfile | null;
  /** The checklist on the card: three items unless a test gives a longer one. */
  checklist: Card["checklist"];
  /** Parts of the address beyond the fixture's two lines. */
  address: AddressParts;
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
  /** Every thumbnail PUT beside a photograph, by its angle. */
  readonly thumbnails: string[];
  /** What the job's card reports, which the fake moves on as writes land. */
  progress: Progress;
}

const accepted = (fake: Fake, eventId: string | null): TechReply<"/api/tech/jobs/{id}/start", "post", 202> => ({
  event_id: eventId ?? "",
  replayed: false,
  fsm_write_state: "written",
  progress: fake.progress,
});

/** Sends the fake's answer, once the contract says mm-api could have sent it (e2e/contract.ts). */
function reply(route: Route, status: number, body?: unknown): Promise<void> {
  const request = route.request();
  assertInContract("tech", request.method(), new URL(request.url()).pathname, status, body);
  return body === undefined ? route.fulfill({ status }) : route.fulfill({ status, json: body });
}

/** Whom a job went to, by first name, and when, as a `409 superseded` names the other technician. */
type WentTo = { technician: string; at: string | null } | null;
const refuse = (route: Route, status: number, code: string, fields: readonly string[] = [], moved: WentTo = null) =>
  reply(route, status, {
    error:
      moved === null
        ? { code, request_id: "test", fields: [...fields] }
        : { code, request_id: "test", fields: [...fields], moved },
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
  const fake: Fake = {
    online: true,
    signedIn: true,
    revoked: false,
    switchedOff: false,
    codeClosed: false,
    codesSent: [],
    malformed: false,
    supersede: null,
    wentTo: null,
    moved: false,
    movedTo: null,
    tooEarly: false,
    refusedPhoto: null,
    checkIn: { passed: true, distance_m: 40 },
    waitMinutes: 15,
    startsAt: null,
    waitLeftMs: null,
    pin: true,
    type: "service",
    oneVisit: false,
    discountCode: null,
    service: null,
    clientChoice: null,
    pieces: [],
    profile: null,
    checklist: CHECKLIST,
    address: {},
    lastVisit: false,
    reminderDelivered: undefined,
    tomorrow: false,
    writes: [],
    photos: [],
    thumbnails: [],
    progress: NOTHING_DONE,
  };

  const jobCard = (today: string) =>
    card(today, fake.progress, {
      pin: fake.pin,
      type: fake.type,
      waitMinutes: fake.waitMinutes,
      startsAt: fake.startsAt,
      pieces: fake.pieces,
      lastVisit: fake.lastVisit,
      reminderDelivered: fake.reminderDelivered,
      address: fake.address,
      oneVisit: fake.oneVisit,
      profile: fake.profile,
      checklist: fake.checklist,
      discountCode: fake.discountCode,
      service: fake.service,
      clientChoice: fake.clientChoice,
    });

  await on.route("**/api/tech/**", async (route: Route) => {
    if (!fake.online) return route.abort();
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    const headers = route.request().headers();
    const eventId = headers["x-client-event-id"] ?? null;
    const startsAt = headers["x-job-starts-at"] ?? null;
    // Asked on every request, so a run that crosses midnight in India reads the new day as the app does.
    const today = todayInIndia();

    // The sign-in: a code for any number, and any six digits right unless the code was closed.
    if (method === "POST" && path === "/api/tech/auth/otp") {
      const body = route.request().postDataJSON() as { mobile: string };
      fake.codesSent.push(body.mobile);
      return reply(route, 202, { challenge_id: CHALLENGE_ID, expires_in_s: 600 });
    }
    if (method === "POST" && path === "/api/tech/auth/verify") {
      if (fake.codeClosed) return refuse(route, 410, "code_expired");
      fake.signedIn = true;
      return reply(route, 200, { verified: true, first_name: ME.first_name, device_id: ME.device.device_id });
    }
    if (fake.revoked) return refuse(route, 401, "device_revoked");
    if (fake.switchedOff) return refuse(route, 401, "technician_inactive");
    if (!fake.signedIn) return refuse(route, 401, "session_required");

    // The photograph itself, and its thumbnail: PUT to the links the API handed out.
    if (method === "PUT" && path.startsWith("/api/tech/photos/")) {
      if (fake.moved) return refuse(route, 404, "not_found");
      const slot = path.slice("/api/tech/photos/".length);
      if (slot.endsWith("/small")) {
        fake.thumbnails.push(slot.slice(0, -"/small".length));
        return reply(route, 204);
      }
      if (slot === fake.refusedPhoto) return refuse(route, 422, "photo_invalid_file");
      fake.photos.push(slot);
      return reply(route, 200, { take: randomUUID() });
    }

    if (method === "POST") {
      if (path === "/api/tech/auth/logout") return reply(route, 204);
      if (path.endsWith("/photos/upload-url")) {
        if (fake.moved) return refuse(route, 409, "superseded", ["technician"], fake.wentTo);
        const body = route.request().postDataJSON() as { phase: string; angle: string };
        return reply(route, 201, {
          upload_url: `/api/tech/photos/${body.phase}-${body.angle}`,
          small_upload_url: `/api/tech/photos/${body.phase}-${body.angle}/small`,
          expires_at: new Date(Date.now() + 900000).toISOString(),
        });
      }

      if (fake.moved) return refuse(route, 409, "superseded", ["technician"], fake.wentTo);
      if (fake.movedTo !== null && startsAt !== null && startsAt !== fake.movedTo) {
        return refuse(route, 409, "superseded", ["time"]);
      }

      const changed = fake.supersede;
      if (changed !== null) return refuse(route, 409, "superseded", changed, fake.wentTo);
      if (path.endsWith("/no-show") && fake.tooEarly) return refuse(route, 425, "too_early_to_close");

      // A one visit's client may decide against the fit, when the piece step carries no label.
      const body = route.request().postDataJSON() as {
        piece_code?: string;
        declined?: boolean;
        product?: string;
      } | null;
      const declined = body?.declined === true;
      if (path.endsWith("/piece") && !declined && !isPieceCode(body?.piece_code ?? "")) {
        return refuse(route, 400, "invalid_request", ["piece_code"]);
      }
      fake.writes.push({ path, eventId, startsAt, body });
      if (path.endsWith("/piece") && fake.oneVisit) {
        fake.clientChoice = declined ? { declined: true } : { product: body?.product ?? "" };
      }

      if (path.endsWith("/checkin")) {
        const now = new Date();
        const waitEnds = new Date(now.getTime() + (fake.waitLeftMs ?? fake.waitMinutes * 60000)).toISOString();
        if (fake.checkIn.passed) {
          fake.progress = {
            ...fake.progress,
            checked_in_at: now.toISOString(),
            wait_ends_at: waitEnds,
            distance_m: fake.checkIn.distance_m,
          };
        }
        return reply(route, 200, {
          passed: fake.checkIn.passed,
          distance_m: fake.checkIn.distance_m,
          radius_m: 200,
          checked_in_at: now.toISOString(),
          wait_ends_at: fake.checkIn.passed ? waitEnds : null,
          accepted: fake.checkIn.passed ? accepted(fake, eventId) : null,
        });
      }
      if (path.endsWith("/start")) {
        fake.progress = { ...fake.progress, started_at: new Date().toISOString() };
        return reply(route, 202, accepted(fake, eventId));
      }

      // The profile is no job event: its answer carries no FSM write (docs/decisions/0106-a-clients-hair-profile.md).
      if (path.endsWith("/profile")) {
        fake.progress = { ...fake.progress, steps_done: [...fake.progress.steps_done, "profile"] };
        return reply(route, 202, { event_id: eventId ?? "", replayed: false, progress: fake.progress });
      }
      if (path.endsWith("/no-show")) {
        fake.progress = { ...fake.progress, outcome: "no_show" };
        return reply(route, 200, {
          closed: true,
          wait_ends_at: new Date().toISOString(),
          case_id: "b0000000-0000-4000-8000-000000000001",
          accepted: accepted(fake, eventId),
        });
      }

      const step = stepOf(path, body as { phase?: string } | null);
      if (step !== null) {
        fake.progress = { ...fake.progress, steps_done: [...fake.progress.steps_done, step] };
        if (step === "outcome") {
          const outcome = (body as { outcome?: string } | null)?.outcome ?? "done";
          fake.progress = { ...fake.progress, outcome };
        }
        return reply(route, 202, accepted(fake, eventId));
      }
      return refuse(route, 404, "not_found");
    }

    if (path === "/api/tech/me") return reply(route, 200, ME);
    if (path === "/api/tech/jobs") {
      const date = url.searchParams.get("date") ?? "";
      // Outside the contract on purpose: what a broken release might send, which the app must survive.
      if (fake.malformed) return route.fulfill({ json: { date, jobs: null } });
      if (date === today) {
        const progress = { started_at: fake.progress.started_at, outcome: fake.progress.outcome };
        return reply(route, 200, { date, jobs: empty ? [] : jobsToday(date, fake.type, progress, fake.oneVisit) });
      }
      if (date === dayAfter(today) && fake.tomorrow) return reply(route, 200, { date, jobs: jobsTomorrow(today) });
      return reply(route, 200, { date, jobs: [] });
    }
    if (path === "/api/tech/pieces/lookup") {
      const code = url.searchParams.get("code") ?? "";
      if (!isPieceCode(code)) return refuse(route, 404, "not_found");
      return reply(route, 200, {
        piece: { ...ROHITS_PIECE, piece_code: code },
        belongs_to_this_job: code === ROHITS_PIECE.piece_code,
      });
    }
    if (path === `/api/tech/jobs/${JOB_ID}/last-visit-photo`) {
      if (fake.moved || !fake.lastVisit) return refuse(route, 404, "not_found");
      assertInContract("tech", method, path, 200);
      return route.fulfill({ contentType: "image/png", body: LAST_VISIT_PHOTO });
    }
    if (path === `/api/tech/jobs/${JOB_ID}`) {
      if (fake.moved) return refuse(route, 404, "not_found");
      const answered = jobCard(today);
      return reply(route, 200, fake.movedTo === null ? answered : { ...answered, starts_at: fake.movedTo });
    }
    if (path === `/api/tech/jobs/${LOCKED_JOB_ID}`) return reply(route, 200, lockedCard(today));
    if (path === `/api/tech/jobs/${TOMORROW_JOB_ID}` && fake.tomorrow) {
      return reply(route, 200, tomorrowCard(today));
    }
    return refuse(route, 404, "not_found");
  });

  return fake;
}

/** The job event a POST stands for, so the fake's progress moves as the real one does. */
function stepOf(path: string, body: { phase?: string } | null): Step | null {
  if (path.endsWith("/photos")) return body?.phase === "after" ? "after_photos" : "before_photos";
  for (const step of ["checklist", "consumables", "piece", "outcome"] as const) {
    if (path.endsWith(`/${step}`)) return step;
  }
  return null;
}
