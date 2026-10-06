// What the client visit tests share (client-visits*, client-photos): the client and their visits, booked and done,
// their photographs, and the app signed in as them.

import { env } from "cloudflare:workers";
import type { VisitType } from "../../../src/config/visit-types.ts";
import { openSession } from "../../../src/domain/sign-in/sessions.ts";
import type { Angle, Phase } from "../../../src/domain/field/visit-photos.ts";
import { NOW } from "../helpers.ts";

export const MOBILE = "+919810000001";

export const OTHER_MOBILE = "+919810000002";

export const NAMES: Record<string, string> = { [MOBILE]: "Rohit Malhotra", [OTHER_MOBILE]: "Someone Else" };

export interface Visit {
  readonly name: string;
  readonly status: "scheduled" | "in_progress" | "completed" | "cancelled" | "terminated";
  readonly type: VisitType;
  readonly mobile: string;
  /** In India's time, as ops book it. */
  readonly start: string;
  readonly end: string;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
}

export const booked = (name: string, overrides: Partial<Visit> = {}): Visit => ({
  name,
  status: "scheduled",
  type: "service",
  mobile: MOBILE,
  start: "2026-09-24T10:00:00+05:30",
  end: "2026-09-24T11:30:00+05:30",
  startedAt: null,
  endedAt: null,
  ...overrides,
});

export const done = (name: string, date: string, overrides: Partial<Visit> = {}) =>
  booked(name, {
    status: "completed",
    start: `${date}T10:00:00+05:30`,
    end: `${date}T11:30:00+05:30`,
    startedAt: `${date}T10:05:00+05:30`,
    endedAt: `${date}T11:15:00+05:30`,
    ...overrides,
  });

/** The photographs taken on two of the done visits: phase, angle, width and height. */
export const PHOTOS: Record<string, readonly (readonly [Phase, Angle, number, number])[]> = {
  "ap-done": [
    ["before", "front", 1200, 1600],
    ["after", "front", 1200, 1600],
  ],
  "ap-earlier": [["after", "front", 800, 1000]],
};

export const utc = (instant: string | null) => (instant === null ? null : new Date(instant).toISOString());

export let cookie: string;

/** Signs the client app in with this session cookie, for the test. */
export const useCookie = (value: string) => {
  cookie = value;
};

export async function signIn(): Promise<void> {
  const person = await env.DB.prepare("SELECT id FROM people WHERE mobile_e164 = ?1")
    .bind(MOBILE)
    .first<{ id: string }>();
  cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: person?.id ?? "", deviceLabel: null, now: NOW })}`;
}
