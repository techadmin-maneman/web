// The jobs staff do, each the grants it needs at once, which the Staff page's add form gives together over the one
// place chosen (apps/ops/src/staff/StaffForm.tsx). A booking needs Operations to act and Customer Care to read the
// client; Finance needs the client to find a payment. Each grant is still the person's own, changed one by one after.

import type { Department, Level } from "./access.ts";

interface PresetGrant {
  readonly department: Department;
  readonly level: Level;
}

export const ROLE_PRESETS = {
  dispatcher: [
    { department: "operations", level: "act" },
    { department: "customer_care", level: "view" },
  ],
  care_agent: [
    { department: "customer_care", level: "act" },
    { department: "operations", level: "view" },
  ],
  city_head: [
    { department: "operations", level: "manage" },
    { department: "customer_care", level: "act" },
    { department: "finance", level: "view" },
    { department: "growth", level: "view" },
  ],
  finance: [
    { department: "finance", level: "act" },
    { department: "customer_care", level: "view" },
    { department: "operations", level: "view" },
  ],
} as const satisfies Readonly<Record<string, readonly PresetGrant[]>>;

export type RolePreset = keyof typeof ROLE_PRESETS;
