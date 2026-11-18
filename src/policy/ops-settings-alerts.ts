// The settings of a technician's alerts (docs/decisions/0250-guides-and-alerts.md), in the Rules table of
// ./ops-settings.ts: how long before setting off they are told to leave, and when the next day's jobs are sent.

import { HOUR_OF_DAY } from "../config/setting-units.ts";
import type { OpsSetting } from "./ops-settings.ts";
import { DAY_AHEAD_HOUR, LEAVE_NOTICE_MINUTES } from "./tech-alerts.ts";
import { REFUSED_MESSAGES, REFUSED_MESSAGES_KEYS } from "./message-refusals.ts";

export const ALERT_RULES = [
  {
    name: "leave_notice_min",
    title: "Time to leave",
    note: "How long before a technician needs to set off the phone tells them to leave. Checked every five minutes.",
    unit: "minutes",
    min: 5,
    max: 30,
    keys: null,
    fallback: LEAVE_NOTICE_MINUTES,
  },
  {
    name: "day_ahead_hour",
    title: "Day ahead",
    note: "When technicians are sent the next day's jobs.",
    unit: HOUR_OF_DAY,
    // Not in the night: the alert wakes the phone.
    min: 6,
    max: 22,
    keys: null,
    fallback: DAY_AHEAD_HOUR,
  },
  {
    // docs/decisions/0277-alerts-that-come-sooner.md.
    name: "refused_messages",
    title: "WhatsApp refused",
    note: "The share of a day's messages of one kind WhatsApp may refuse before Care are told, and the fewest sent before it counts.",
    unit: "per cent",
    min: 1,
    max: 100,
    keys: REFUSED_MESSAGES_KEYS,
    bounds: {
      share: { min: 1, max: 100, unit: "per cent" },
      least: { min: 1, max: 100, unit: "messages" },
    },
    fallback: REFUSED_MESSAGES,
  },
] as const satisfies readonly OpsSetting[];
