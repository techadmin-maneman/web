// The one home Today opens for a person (ADR 0227, ADR 0238), from their grants as whoami gives them: a person whose
// every grant keeps to one city has the City head's; operations' is Dispatch, Customer Care's is Care, Finance's is
// Finance. Anyone else, as Growth or Admin alone, has Dispatch; so does everyone while the Staff list is not enforced.

import type { Tasks, Whoami } from "../api.ts";

export type Home = "dispatch" | "care" | "city" | "finance";

type Staff = Whoami["staff"];
type Group = Tasks["groups"][number]["group"];

/** One city a person's grants all keep to; null where any reaches further, or there are none. */
function oneCity(staff: Staff): string | null {
  const places = new Set(staff.grants.map((grant) => (grant.geography === "city" ? grant.place : null)));
  const [only = null] = places;
  return places.size === 1 ? only : null;
}

/** The person's home. */
export function homeOf(staff: Staff): Home {
  if (!staff.enforced || staff.grants.length === 0) return "dispatch";
  if (oneCity(staff) !== null) return "city";
  const has = (department: Staff["grants"][number]["department"]) =>
    staff.grants.some((grant) => grant.department === department);
  if (has("operations")) return "dispatch";
  if (has("customer_care")) return "care";
  if (has("finance")) return "finance";
  return "dispatch";
}

/** How many the board holds of a group of tasks. */
export const countOf = (board: Tasks, group: Group): number =>
  board.groups.find((each) => each.group === group)?.count ?? 0;
