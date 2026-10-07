// What Activity is narrowed to, kept in the page's address so a narrowed log can be linked to and opened again:
// "/activity?person=…&from=2026-10-01". A value the API would refuse is left out, so a link typed wrong opens the whole
// log rather than an error.

import type { ActivityAction, ActivityAsked } from "../api.ts";
import { activity } from "../content.ts";

export type Filters = Omit<ActivityAsked, "before">;
type ActorKind = NonNullable<Filters["actor_kind"]>;

export const ACTOR_KINDS: readonly ActorKind[] = ["staff", "service", "client", "technician", "system"];

export const ACTIONS = Object.keys(activity.actions) as ActivityAction[];

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** What the address's query narrows the log to. */
export function filtersOf(search: string): Filters {
  const query = new URLSearchParams(search);
  const text = (name: string) => {
    const value = query.get(name)?.trim() ?? "";
    return value === "" ? undefined : value;
  };
  const date = (name: string) => {
    const value = query.get(name);
    return value !== null && DATE.test(value) ? value : undefined;
  };
  return {
    actor_kind: ACTOR_KINDS.find((kind) => kind === query.get("actor_kind")),
    actor: text("actor"),
    action: ACTIONS.find((action) => action === query.get("action")),
    person: text("person"),
    visit: text("visit"),
    from: date("from"),
    to: date("to"),
  };
}

/** Activity narrowed as `filters` say: "/activity" for the whole log. */
export function activityPath(filters: Filters): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) {
    if (typeof value === "string" && value !== "") query.set(name, value);
  }
  const search = query.toString();
  return search === "" ? "/activity" : `/activity?${search}`;
}

/** The query the API is asked with: only what is set. */
export function askedOf(filters: Filters, before?: number): ActivityAsked {
  const asked: ActivityAsked = {};
  for (const [name, value] of Object.entries(filters)) {
    if (typeof value === "string" && value !== "") Object.assign(asked, { [name]: value });
  }
  return before === undefined ? asked : { ...asked, before };
}
