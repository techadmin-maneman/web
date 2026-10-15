// What Activity is narrowed to, kept in the page's address so a narrowed log can be linked to and opened again:
// "/activity?person=…&from=2026-10-01" (activityPath, ../route.ts). A value the API would refuse is left out, so a link
// typed wrong opens the whole log rather than an error.

import type { ActivityAction, ActivityAsked } from "../api.ts";
import { activity } from "../content/activity.ts";

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
    reads: query.get("reads") === "include" ? "include" : undefined,
  };
}

/** The query the API is asked with: only what is set. */
export function askedOf(filters: Filters, cursor?: string): ActivityAsked {
  const asked: ActivityAsked = {};
  for (const [name, value] of Object.entries(filters)) {
    if (typeof value === "string" && value !== "") Object.assign(asked, { [name]: value });
  }
  return cursor === undefined ? asked : { ...asked, cursor };
}

/** A filter that is set, in words, as its chip says it: "Who · Technician", "From · 2026-10-01". */
export interface Applied {
  readonly name: keyof Filters;
  readonly words: string;
}

const words = activity.filters;

/** Each filter that is set, in the order the form asks for them, the client or visit a link set first. */
export function appliedOf(filters: Filters): Applied[] {
  const applied: Applied[] = [];
  if (filters.person !== undefined)
    applied.push({ name: "person", words: `${words.person} · ${filters.person.slice(0, 8)}` });
  if (filters.visit !== undefined)
    applied.push({ name: "visit", words: `${words.visit} · ${filters.visit.slice(0, 8)}` });
  if (filters.actor_kind !== undefined) {
    applied.push({ name: "actor_kind", words: `${words.kind} · ${words.kinds[filters.actor_kind]}` });
  }
  if (filters.actor !== undefined) applied.push({ name: "actor", words: `${words.kind} · ${filters.actor}` });
  if (filters.action !== undefined) {
    applied.push({ name: "action", words: `${words.action} · ${activity.actions[filters.action]}` });
  }
  if (filters.from !== undefined) applied.push({ name: "from", words: `${words.from} · ${filters.from}` });
  if (filters.to !== undefined) applied.push({ name: "to", words: `${words.to} · ${filters.to}` });
  if (filters.reads !== undefined) applied.push({ name: "reads", words: words.reads });
  return applied;
}
