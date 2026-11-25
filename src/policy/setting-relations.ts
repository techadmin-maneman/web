// Rules that must hold against one another, each checked when either side is saved (docs/decisions/0319-rules-that-
// hold-together.md). Within one rule its own `conflicts` check its figures (./ops-settings.ts); these cross rules:
//
// - the check-in radius, the nation's or a city's, no wider than the radius at a rough pin;
// - the address unlocking no earlier than reminders go, the nation's or a city's, when allotment fixes tomorrow's
//   visits, so no technician sees the address of a visit that may then go to another;
// - the booking break within the working day;
// - a task lapsing no sooner than its longest deadline, so none leaves the board before it was ever overdue.
//
// A conflict names the box being saved, then the other rule's box it is held against. The forecast's reach against
// suppliers' lead times, which are data, is held apart (src/domain/purchasing/lead-horizon.ts).

type Figures = Readonly<Record<string, number>>;

/** The national rules some other rule is held against, so a save of any other reads nothing more. */
export const HELD_TOGETHER: ReadonlySet<string> = new Set([
  "checkin_radius_m",
  "checkin_radius_approximate_m",
  "address_unlock_hour",
  "reminder_hour",
  "booking_rules",
  "working_hours",
  "task_lapse_days",
  "task_sla_hours",
]);

/** What the other side of each relation stands at now: the national rules, and the cities' own figures for theirs. */
export interface Standing {
  readonly checkinRadius: number;
  readonly roughRadius: number;
  readonly unlockHour: number;
  readonly reminderHour: number;
  readonly workingHours: { readonly opens: number; readonly closes: number };
  readonly breakHours: { readonly from: number; readonly to: number };
  readonly taskDeadlines: Figures;
  readonly lapseDays: number;
  /** The cities' own check-in radii and reminder hours. */
  readonly cityRadii: readonly number[];
  readonly cityReminderHours: readonly number[];
}

export type Conflict = readonly [string, string];

const most = (figures: readonly number[]): number => Math.max(-Infinity, ...figures);

/**
 * The deadline that runs longest, and its queue. A task written by hand lapses from its own due date, not its queue's
 * deadline, so those queues' deadlines are no part of it.
 */
function longestDeadline(deadlines: Figures): { key: string; hours: number } | null {
  let longest: { key: string; hours: number } | null = null;
  for (const [key, hours] of Object.entries(deadlines)) {
    if (key.startsWith("staff_task_")) continue;
    if (longest === null || hours > longest.hours) longest = { key, hours };
  }
  return longest;
}

const figureOf = (value: unknown, key: string): number | null => {
  if (typeof value !== "object" || value === null) return null;
  const figure = (value as Record<string, unknown>)[key];
  return typeof figure === "number" ? figure : null;
};

/** A national rule's new value against the rules it is held to; null where it holds. */
export function nationalConflict(name: string, value: unknown, standing: Standing): Conflict | null {
  switch (name) {
    case "checkin_radius_m":
      return typeof value === "number" && value > standing.roughRadius
        ? ["checkin_radius_m", "checkin_radius_approximate_m"]
        : null;
    case "checkin_radius_approximate_m":
      return typeof value === "number" && value < most([standing.checkinRadius, ...standing.cityRadii])
        ? ["checkin_radius_approximate_m", "checkin_radius_m"]
        : null;
    case "address_unlock_hour":
      return typeof value === "number" && value < most([standing.reminderHour, ...standing.cityReminderHours])
        ? ["address_unlock_hour", "reminder_hour"]
        : null;
    case "reminder_hour":
      return typeof value === "number" && value > standing.unlockHour ? ["reminder_hour", "address_unlock_hour"] : null;
    case "booking_rules":
      return breakConflict(value, standing);
    case "working_hours":
      return dayConflict(value, standing);
    case "task_lapse_days": {
      const longest = longestDeadline(standing.taskDeadlines);
      return typeof value === "number" && longest !== null && value * 24 < longest.hours
        ? ["task_lapse_days", `task_sla_hours.${longest.key}`]
        : null;
    }
    case "task_sla_hours": {
      const longest = typeof value === "object" && value !== null ? longestDeadline(value as Figures) : null;
      return longest !== null && longest.hours > standing.lapseDays * 24
        ? [`task_sla_hours.${longest.key}`, "task_lapse_days"]
        : null;
    }
    default:
      return null;
  }
}

/** The break in a new booking rule against the working day. */
function breakConflict(value: unknown, standing: Standing): Conflict | null {
  const from = figureOf(value, "break_from");
  const to = figureOf(value, "break_to");
  if (from !== null && from < standing.workingHours.opens) return ["booking_rules.break_from", "working_hours.opens"];
  if (to !== null && to > standing.workingHours.closes) return ["booking_rules.break_to", "working_hours.closes"];
  return null;
}

/** A new working day against the booking break. */
function dayConflict(value: unknown, standing: Standing): Conflict | null {
  const opens = figureOf(value, "opens");
  const closes = figureOf(value, "closes");
  if (opens !== null && opens > standing.breakHours.from) return ["working_hours.opens", "booking_rules.break_from"];
  if (closes !== null && closes < standing.breakHours.to) return ["working_hours.closes", "booking_rules.break_to"];
  return null;
}

/** A city's own figure for one of its rules against the national rule it is held to; null where it holds. */
export function cityConflict(name: string, value: unknown, standing: Standing): Conflict | null {
  if (typeof value !== "number") return null;
  if (name === "checkin_radius_m" && value > standing.roughRadius) {
    return ["checkin_radius_m", "checkin_radius_approximate_m"];
  }
  if (name === "reminder_hour" && value > standing.unlockHour) return ["reminder_hour", "address_unlock_hour"];
  return null;
}
