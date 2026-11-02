// Which homes Today offers a person (ADR 0227), from their grants as whoami gives them: operations' are Dispatch and
// Inventory, Customer Care's is Care, Finance's is Finance, and a person whose every grant is in one city has the City
// head's first. Anyone else, as Growth or Admin alone, has Dispatch; while the Staff list is not enforced, every home.

import type { Department } from "@rules/policy/access.ts";
import { TASK_DEPARTMENTS } from "@rules/policy/console-routes.ts";
import type { TaskGroup, Tasks, Whoami } from "../api.ts";

export const HOMES = ["dispatch", "care", "city", "finance", "inventory"] as const;
export type Home = (typeof HOMES)[number];

type Staff = Whoami["staff"];
type Group = TaskGroup["group"];

/** One city a person's grants all keep to; null where any reaches further, or there are none. */
function oneCity(staff: Staff): string | null {
  const places = new Set(staff.grants.map((grant) => (grant.geography === "city" ? grant.place : null)));
  const [only = null] = places;
  return places.size === 1 ? only : null;
}

/** The person's homes, the first the one Today opens on. */
export function homesOf(staff: Staff): readonly Home[] {
  if (!staff.enforced || staff.grants.length === 0) return HOMES;
  const has = (department: Staff["grants"][number]["department"]) =>
    staff.grants.some((grant) => grant.department === department);
  const theirs = new Set<Home>();
  if (has("operations")) {
    theirs.add("dispatch");
    theirs.add("inventory");
  }
  if (has("customer_care")) theirs.add("care");
  if (has("finance")) theirs.add("finance");
  if (theirs.size === 0) theirs.add("dispatch");
  const ordered = HOMES.filter((home) => home !== "city" && theirs.has(home));
  return oneCity(staff) === null ? ordered : ["city", ...ordered];
}

/** The tasks of operations that are about stock, which Inventory lists; Dispatch lists operations' others. */
const STOCK_GROUPS: readonly Group[] = ["stock_at_risk", "consumables_short", "replacement_order"];

/** The departments whose tasks each home lists under Needs you; the City head lists every task in their city. */
const HOME_DEPARTMENTS: Readonly<Record<Home, readonly Department[] | "all">> = {
  dispatch: ["operations"],
  care: ["customer_care"],
  city: "all",
  finance: ["finance"],
  inventory: ["operations"],
};

/** Whether the home lists the group: one of its departments decides it, and it is about stock where the home is. */
function listedOn(home: Home, group: Group): boolean {
  const departments = HOME_DEPARTMENTS[home];
  if (departments !== "all" && !departments.includes(TASK_DEPARTMENTS[group])) return false;
  if (home === "inventory") return STOCK_GROUPS.includes(group);
  return home !== "dispatch" || !STOCK_GROUPS.includes(group);
}

/**
 * Whether a home lists a task of the group under Needs you. A group none of the person's homes lists, as Growth's
 * referrals, is listed on their first, so nothing on their board goes unseen from Today.
 */
export function homeLists(home: Home, homes: readonly Home[], group: Group): boolean {
  if (listedOn(home, group)) return true;
  return home === homes[0] && !homes.some((each) => listedOn(each, group));
}

/** How many the board holds of a group of tasks. */
export const countOf = (board: Tasks, group: Group): number =>
  board.groups.find((each) => each.group === group)?.count ?? 0;
