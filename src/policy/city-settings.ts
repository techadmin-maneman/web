// The rules a city may set apart from the national ones (docs/decisions/0198-cities-as-data.md): those its streets,
// its GPS and its mornings make different. A city that sets none follows the national rule; every other rule is
// national, Care's hours among them, since one Care team answers every city from one inbox.

import { indiaTime } from "../lib/india-time.ts";
import type { OpsSettingName } from "./ops-settings.ts";

export const CITY_SETTING_NAMES = ["checkin_radius_m", "reminder_hour"] as const satisfies readonly OpsSettingName[];

export type CitySettingName = (typeof CITY_SETTING_NAMES)[number];

export const isCitySetting = (name: string): name is CitySettingName =>
  (CITY_SETTING_NAMES as readonly string[]).includes(name);

/** Whether an hour of the day has come in India: 10 is 10:00 on. */
export const hourHasCome = (hour: number, now: Date): boolean =>
  indiaTime(now) >= `${String(hour).padStart(2, "0")}:00`;
