// A hold as the client API answers it (GET /api/holds/{id}), for the booking sheet's tests: a service visit held for
// ten more minutes, paid for in full, whose payment a late change keeps. Every name and number is made up.

import type { Hold } from "../../apps/app/src/api.ts";

export const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

export function holdOf(over: Partial<Hold> = {}): Hold {
  return {
    id: "a1b2c3d4-0000-4000-8000-000000000001",
    type: "service",
    service: { tier: "standard", name: "Service visit", minutes: 90 },
    date: "2026-10-20",
    window: "morning",
    hours: { start: "09:00", end: "12:00" },
    starts_at: "2026-10-20T03:30:00.000Z",
    ends_at: "2026-10-20T05:00:00.000Z",
    technician: { name: "Imran Qureshi", initials: "IQ" },
    price: { amount_ex_gst: 200000, amount: 200000, gst_percent: 0 },
    late_fee: null,
    free_until: minutesFromNow(24 * 60),
    change_notice_hours: 24,
    late_change_charge: "visit",
    expires_at: minutesFromNow(10),
    pay_by: minutesFromNow(12),
    state: "held",
    paid: false,
    visit_id: null,
    moves_visit_id: null,
    credit: null,
    discount: null,
    ...over,
  };
}
