// The Settings words the console needs on every page: its pages' names and its groups', which the navigation and the
// titles read, and how a grant is said, which the shell reads for access. The rest load with Settings' screens
// (./settings.ts).

import { DEPARTMENT_NAMES } from "./shell.ts";

export const settingsGroupNames = {
  business: "Business",
  scheduling: "Scheduling",
  visits: "Visits",
  prices: "Prices",
  growth: "Growth",
  care: "Care",
  inventory: "Inventory",
  team: "Team",
  system: "System",
};

export const settingsPageNames = {
  cities: "Cities",
  areas: "Areas",
  targets: "Targets",
  "window-times": "Window times",
  "closed-days": "Closed days",
  booking: "Booking",
  moves: "Moves and no-shows",
  field: "Field",
  reminders: "Reminders",
  "job-sheet": "Job sheet",
  services: "Services",
  "hair-systems": "Hair systems",
  "discount-codes": "Discount codes",
  referrals: "Referrals",
  partners: "Partners",
  "try-on": "Try-on",
  words: "Words",
  "care-team": "Team",
  "care-hours": "Hours",
  remedies: "Remedies",
  "quick-replies": "Quick replies",
  stock: "Stock",
  purchasing: "Purchasing",
  "supply-plan": "Supply plan",
  staff: "Staff",
  "pay-grades": "Pay grades",
  console: "Console",
  limits: "Daily limits",
  reports: "Reports",
};

/** "Customer Care · Act · National" */
export const grantPhrasing = {
  departments: DEPARTMENT_NAMES,
  levels: { view: "View", act: "Act", manage: "Manage" },
  national: "National",
  zone: (name: string) => `${name} zone`,
  grant: (department: string, level: string, place: string) => `${department} · ${level} · ${place}`,
};
