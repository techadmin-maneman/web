// What the dispatch board tests share (dispatch*.test.ts): the technicians, clients and visits on the board, a job put
// on it, and the shapes the board and Tasks answer in.

import { env } from "cloudflare:workers";
import { NOW } from "../helpers.ts";
import { visit } from "../visits.ts";

export const ROHIT = "11111111-1111-4111-8111-111111111111";

/** Another client, whose visits fill the technicians' days: a technician never takes two of one client's in a row. */
export const VIKRAM = "vikram";

export const IMRAN = "33333333-3333-4333-8333-333333333331";

export const SAMEER = "33333333-3333-4333-8333-333333333332";

export const FIT = "22222222-2222-4222-8222-222222222221";

export const REPLACEMENT = "22222222-2222-4222-8222-222222222222";

/** Two service visits, for the moves that meet each other. */
export const A = "22222222-2222-4222-8222-2222222222a1";

export const B = "22222222-2222-4222-8222-2222222222b1";

export const WEDNESDAY = "2026-09-23";

/** Tuesday 22 September in India, as UTC: each half-slot's start (docs/decisions/0035-window-slot-map.md). */
export const TUESDAY = {
  "09:00": "2026-09-22T03:30:00.000Z",
  "10:30": "2026-09-22T05:00:00.000Z",
  "12:00": "2026-09-22T06:30:00.000Z",
  "14:00": "2026-09-22T08:30:00.000Z",
} as const;

export const MINUTES = { consultation: 60, service: 90, replacement: 135, first_fit: 180 } as const;

export type Kind = keyof typeof MINUTES;

export const insertJob = (
  id: string,
  options: {
    type: Kind;
    start: string;
    technician: string | null;
    person?: string | null;
    status?: string;
    city?: string;
    pincode?: string;
  },
) =>
  visit(id, {
    ...options,
    person: options.person === undefined ? ROHIT : options.person,
    minutes: MINUTES[options.type],
  });

/** The job as it stands now, which is what a board loaded now would show. */
export const shown = (id: string) =>
  env.DB.prepare("SELECT technician_id, window_start FROM appointments WHERE id = ?1")
    .bind(id)
    .first<{ technician_id: string | null; window_start: string }>();

export const toSameerWednesdayMorning = (id: string) => ({
  appointment_id: id,
  technician_id: SAMEER,
  date: WEDNESDAY,
  window: "morning",
  reason: "zone_rebalance",
});

export interface BoardBody {
  from: string;
  technicians: {
    technician_id: string;
    days: { date: string; blocks: Record<string, unknown>[] }[];
  }[];
  unassigned: Record<string, unknown>[];
  utilisation: { date: string; percent: number }[];
  city: string | null;
  cities: string[];
}

/** Rohit's word on WhatsApp about his visits, as the app's switch records it. */
export const agreeToVisitMessages = (granted: boolean) =>
  env.DB.prepare(
    `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
     VALUES (?1, ?2, 'whatsapp_visits', 'whatsapp-visits-v1', ?3, ?4)`,
  )
    .bind(crypto.randomUUID(), ROHIT, granted ? 1 : 0, NOW.toISOString())
    .run();

export interface TaskGroupBody {
  group: string;
  tasks: {
    id: string;
    person: { id: string; name: string; mobile?: string } | null;
    detail: string | null;
    visit?: { id: string; starts_at: string };
  }[];
}
