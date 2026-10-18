// The settings of booking by start time (docs/decisions/0210-booking-by-start-time.md), in the Rules table of
// ./ops-settings.ts: the starts, the arrival window and the day's limits; which visits may be booked for today; a
// city's working hours; and the drive estimate. A city may set its own hours and drive estimate (./city-settings.ts).

import { HOUR_OF_DAY } from "../config/setting-units.ts";
import { DRIVE_ESTIMATE, DRIVE_ESTIMATE_KEYS, driveEstimateConflicts, type DriveEstimate } from "./drive-estimate.ts";
import type { OpsSetting } from "./ops-settings.ts";
import {
  BOOKING_RULE_KEYS,
  BOOKING_RULES,
  bookingRuleConflicts,
  SAME_DAY_BOOKING,
  SAME_DAY_CHOICES,
  SAME_DAY_KEYS,
  WORKING_HOURS,
  WORKING_HOURS_KEYS,
  workingHoursConflicts,
  type BookingRules,
  type WorkingHours,
} from "./start-times.ts";

export const BOOKING_SETTINGS = [
  {
    name: "booking_rules",
    title: "Start times",
    note: "How far apart the starts clients pick from are, how long after one a technician may arrive, and what each day holds.",
    unit: "minutes",
    min: 0,
    max: 120,
    keys: BOOKING_RULE_KEYS,
    bounds: {
      step: { min: 15, max: 60 },
      arrival: { min: 0, max: 120 },
      wrap_up: { min: 0, max: 60 },
      lead: { min: 1, max: 24, unit: "hours" },
      break: { min: 0, max: 90 },
      break_from: { min: 10, max: 16, unit: HOUR_OF_DAY },
      break_to: { min: 11, max: 18, unit: HOUR_OF_DAY },
      visits: { min: 1, max: 12, unit: "visits" },
      fits: { min: 0, max: 6, unit: "fits" },
    },
    fallback: BOOKING_RULES,
    conflicts: (value) => bookingRuleConflicts(value as BookingRules),
  },
  {
    name: "same_day_booking",
    title: "Booking for today",
    note: "Which visits a client may book for today, from the lead time on.",
    keys: SAME_DAY_KEYS,
    choices: Object.fromEntries(SAME_DAY_KEYS.map((type) => [type, SAME_DAY_CHOICES])),
    fallback: SAME_DAY_BOOKING,
  },
  {
    name: "working_hours",
    title: "Working hours",
    note: "The day a technician works when they have no week of their own.",
    unit: HOUR_OF_DAY,
    min: 5,
    max: 23,
    keys: WORKING_HOURS_KEYS,
    bounds: { opens: { min: 5, max: 12 }, closes: { min: 12, max: 23 } },
    fallback: WORKING_HOURS,
    conflicts: (value) => workingHoursConflicts(value as WorkingHours),
  },
  {
    name: "drive_estimate",
    title: "Drive estimate",
    note: "How drives between visits are estimated: the road against the straight line, the speeds in and out of the rush, and the time to park.",
    unit: "minutes",
    min: 0,
    max: 300,
    keys: DRIVE_ESTIMATE_KEYS,
    bounds: {
      road_factor: { min: 100, max: 300, unit: "% of the straight line" },
      peak_kmh: { min: 5, max: 60, unit: "km/h" },
      offpeak_kmh: { min: 5, max: 80, unit: "km/h" },
      parking: { min: 0, max: 30 },
      least: { min: 0, max: 60 },
      morning_from: { min: 5, max: 12, unit: HOUR_OF_DAY },
      morning_to: { min: 6, max: 13, unit: HOUR_OF_DAY },
      evening_from: { min: 13, max: 22, unit: HOUR_OF_DAY },
      evening_to: { min: 14, max: 23, unit: HOUR_OF_DAY },
    },
    fallback: DRIVE_ESTIMATE,
    conflicts: (value) => driveEstimateConflicts(value as DriveEstimate),
  },
] as const satisfies readonly OpsSetting[];
