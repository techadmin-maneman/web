// Boards A1, A2 and A3: the week the dispatch board draws, where a job in hand
// could land, and what a move answers.

import type { OpsReply } from "../answer.ts";

type Board = OpsReply<"/api/dispatch">;
type Block = Board["technicians"][number]["days"][number]["blocks"][number];
type TrayJob = Board["unassigned"][number];
type VisitType = NonNullable<Block["type"]>;
type Window = Block["window"];

/** Fri 19 to Thu 25 September, the week board A1 heads, in a year whose days fall as it draws them. */
const DATES = [
  "2025-09-19",
  "2025-09-20",
  "2025-09-21",
  "2025-09-22",
  "2025-09-23",
  "2025-09-24",
  "2025-09-25",
] as const;

const dateOf = (day: number): string => DATES[day] ?? DATES[0];

/** Each column's utilisation, as the board letters it; 92 and 88 are the weekend's peak. */
const UTILISATION = [64, 92, 88, 58, 64, 61, 67];

const IMRAN = { id: "66000000-0000-4000-8000-000000000001", name: "Imran Qureshi", initials: "IQ", zone: "Sec 40–65" };
const SANDEEP = { id: "66000000-0000-4000-8000-000000000002", name: "Sandeep Yadav", initials: "SY", zone: "Sec 1–39" };
const ARJUN = { id: "66000000-0000-4000-8000-000000000003", name: "Arjun Negi", initials: "AN", zone: "DLF 1–5" };
const FAIZAN = { id: "66000000-0000-4000-8000-000000000004", name: "Faizan Ali", initials: "FA", zone: "Sohna Rd" };
const BOARD_TECHNICIANS = [IMRAN, SANDEEP, ARJUN, FAIZAN];

/** "Blocks are sized by slot: consultation and service 1, replacement 1.5, first fit 2." */
const SLOTS: Readonly<Record<VisitType, number>> = { consultation: 1, service: 1, replacement: 1.5, first_fit: 2 };
/** Each window's first half-slot in India's time, as UTC (docs/decisions/0035-window-slot-map.md). */
const STARTS: Readonly<Record<Window, string>> = { morning: "03:30", afternoon: "06:30", evening: "10:30" };

/** Rohit Malhotra, board A3's client: agreed to WhatsApp about his visits, and invited by nobody. */
export const ROHIT = {
  id: "11000000-0000-4000-8000-000000000001",
  name: "Rohit Malhotra",
  mobile: "+919810000001",
  whatsapp_visits: true,
  referred_by: null,
} satisfies Block["person"];

/** Vikram Sethi: never agreed to WhatsApp about his visits, so a move of his is told by phone (ADR 0069). */
export const VIKRAM = {
  id: "11000000-0000-4000-8000-000000000002",
  name: "Vikram Sethi",
  mobile: "+919810000002",
  whatsapp_visits: false,
  referred_by: "Rohit Malhotra",
} satisfies Block["person"];

let jobs = 0;
const job = (
  type: VisitType,
  client: string | null,
  sector: string,
  day: number,
  window: Window,
  person: Block["person"] = null,
): Block => ({
  appointment_id: `77000000-0000-4000-8000-${String(++jobs).padStart(12, "0")}`,
  type,
  service: null,
  client,
  sector,
  pincode: "122018",
  person,
  badge: "prepaid",
  slots: SLOTS[type],
  starts_at: `${dateOf(day)}T${STARTS[window]}:00.000Z`,
  window,
  status: "scheduled",
  notice_hours: 24,
  untold: null,
  begun: null,
});

/** One technician's row: their seven days, from the blocks given against the day each falls on. */
const row = (
  technician: (typeof BOARD_TECHNICIANS)[number],
  blocks: readonly { day: number; block: Block }[],
): Board["technicians"][number] => ({
  technician_id: technician.id,
  name: technician.name,
  initials: technician.initials,
  zone: technician.zone,
  days: DATES.map((date, day) => ({
    date,
    blocks: blocks.filter((each) => each.day === day).map((each) => each.block),
  })),
});

const on = (day: number, block: Block) => ({ day, block });

const tray = (
  id: number,
  type: VisitType,
  asked: Window | null,
  offered: Window,
  day: number,
  sector: string,
  person: Block["person"],
): TrayJob => ({
  appointment_id: `78000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
  type,
  service: null,
  client:
    person === null ? null : `${person.name.split(" ")[0] ?? ""} ${(person.name.split(" ")[1] ?? "").slice(0, 1)}.`,
  sector,
  pincode: "122018",
  person,
  badge: "prepaid",
  slots: SLOTS[type],
  starts_at: `${dateOf(day)}T${STARTS[offered]}:00.000Z`,
  asked_window: asked,
  offered_window: offered,
  date: dateOf(day),
  was_technician: null,
});

/**
 * The board's own week: the design's rows, with two jobs in a cell put in
 * different windows, because a technician cannot hold two in one (ADR 0034).
 */
export const BOARD = {
  version: 1,
  from: DATES[0],
  dates: [...DATES],
  city: null,
  cities: ["Gurgaon", "Delhi", "Noida"],
  technicians: [
    row(IMRAN, [
      on(0, job("service", "Rohit M.", "Sec 65", 0, "morning", ROHIT)),
      on(0, job("service", "Vikram S.", "DLF 4", 0, "afternoon", VIKRAM)),
      on(1, job("first_fit", "Sanjay B.", "Sec 43", 1, "morning")),
      on(2, job("consultation", "Nikhil A.", "Sec 57", 2, "morning")),
      on(2, job("service", "Aman T.", "Sec 49", 2, "afternoon")),
      on(3, job("service", "Deepak R.", "Sec 54", 3, "afternoon")),
      on(4, job("replacement", "Kunal M.", "Sec 62", 4, "afternoon")),
      on(6, job("service", "Rohit M.", "Sec 65", 6, "morning", ROHIT)),
    ]),
    row(SANDEEP, [
      on(0, job("service", "Arun P.", "Sec 23", 0, "morning")),
      on(1, job("replacement", "Manish G.", "Sec 31", 1, "afternoon")),
      on(1, job("consultation", "Tarun J.", "Sec 15", 1, "evening")),
      on(2, job("first_fit", "Ravi S.", "Sec 28", 2, "morning")),
      on(4, job("service", "Sameer L.", "Sec 12", 4, "morning")),
      on(5, job("service", "Vivek N.", "Sec 35", 5, "afternoon")),
    ]),
    row(ARJUN, [
      on(0, job("service", "Gaurav D.", "DLF 2", 0, "morning")),
      on(1, job("first_fit", "Rahul K.", "DLF 5", 1, "morning")),
      on(2, job("service", "Anil V.", "DLF 1", 2, "morning")),
      on(2, job("consultation", "Puneet S.", "DLF 3", 2, "afternoon")),
      on(3, job("replacement", "Mohit A.", "DLF 4", 3, "afternoon")),
      on(5, job("service", "Varun C.", "DLF 2", 5, "morning")),
      on(6, job("service", "Kabir H.", "DLF 5", 6, "afternoon")),
    ]),
    row(FAIZAN, [
      on(1, job("service", "Dev M.", "Sohna", 1, "morning")),
      on(1, job("consultation", "Ishaan B.", "Sohna", 1, "evening")),
      on(2, job("service", "Nitin R.", "Sohna", 2, "afternoon")),
      on(3, job("service", "Yash T.", "Sohna", 3, "morning")),
      on(6, job("replacement", "Hari P.", "Sohna", 6, "afternoon")),
    ]),
  ],
  /**
   * The tray's first two are its whole point — a client asked for one window
   * and is being offered another — and the last has no Request behind it, so
   * nothing recorded what was asked (ADR 0063). The first was invited by Rohit.
   */
  unassigned: [
    tray(1, "first_fit", "morning", "evening", 1, "Sec 43", VIKRAM),
    tray(2, "service", "evening", "morning", 1, "Sec 12", null),
    tray(3, "consultation", "morning", "morning", 2, "DLF 3", null),
    tray(4, "replacement", null, "afternoon", 2, "Sohna", null),
  ],
  utilisation: DATES.map((date, day) => ({ date, percent: UTILISATION[day] ?? 0 })),
  /** Leave ops recorded, clipped to this week: Faizan is away on the Sunday and Monday (ADR 0062). */
  leave: [{ technician_id: FAIZAN.id, from: DATES[2], to: DATES[3], note: "Family wedding" }],
} satisfies Board;

/**
 * Where a job in hand would land, as the room route answers: every window of
 * every day but Faizan's two days away, Sandeep's full Saturday afternoon, and
 * Arjun's Tuesday, which has no room at all.
 */
export const ROOM = {
  appointment_id: "77000000-0000-4000-8000-000000000001",
  rooms: BOARD_TECHNICIANS.flatMap((technician) =>
    DATES.map((date) => roomOn(technician.id, date, technician === SANDEEP && date === DATES[1] ? "afternoon" : null)),
  ).filter((room) => {
    const faizanAway = room.technician_id === FAIZAN.id && (room.date === DATES[2] || room.date === DATES[3]);
    const arjunFull = room.technician_id === ARJUN.id && room.date === DATES[4];
    return !faizanAway && !arjunFull;
  }),
  blackouts: [],
} satisfies OpsReply<"/api/dispatch/room">;

/** A technician's day with every window but the one taken, if one is, each at its first half-slot. */
function roomOn(technicianId: string, date: string, taken: Window | null) {
  const allWindows: Window[] = ["morning", "afternoon", "evening"];
  const windows = allWindows.filter((window) => window !== taken);
  const starts = windows.map((window) => ({ window, starts_at: `${date}T${STARTS[window]}:00.000Z` }));
  return { technician_id: technicianId, date, windows, starts };
}

export const MOVED = {
  move_id: "79000000-0000-4000-8000-000000000001",
  client_notice: "messaged",
} satisfies OpsReply<"/api/dispatch/move", "post">;
