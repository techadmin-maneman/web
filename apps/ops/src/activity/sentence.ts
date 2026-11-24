// An entry in the log as a sentence: who, what they did, and the record it touched where the words name it, "Sandeep
// Yadav closed the visit for Neha Kapoor". Apart from ./ActivityScreen.tsx, so the node tests read it and the file.

import { ROUTE_NEEDS } from "@rules/policy/console-routes.ts";
import { indiaDate, indiaTimeOf } from "@maneman/web-kit/dates";
import type { components } from "../api-schema.ts";
import { activity } from "../content/activity.ts";
import { CONSOLE_CALLS, DONE, SESSION_CALLS } from "../content/activity-sentences.ts";

type Entry = components["schemas"]["ActivityEntry"];

const copy = activity;

/** A person or a record a sentence names, and the page the name opens: a client's, a visit's, a technician's. */
export interface Named {
  readonly words: string;
  readonly opens: { readonly kind: "client" | "visit" | "technician"; readonly id: string } | null;
}

export interface Sentence {
  readonly who: Named;
  /** What was done: the words before the record's name, the name, and the words after it. */
  readonly before: string;
  readonly named: Named | null;
  readonly after: string;
  readonly refused: boolean;
}

const PLACE = "{name}";

const TEMPLATES = Object.keys(ROUTE_NEEDS).map((key) => {
  const [method = "", template = ""] = key.split(" ");
  return { method, template, pattern: new RegExp(`^${template.replace(/\{[^}]+\}/g, "[^/]+")}$`) };
});

/** The route a call reached, "/api/tech/jobs/{id}/outcome": as the log names it, else from its path. */
export function routeOf(detail: Entry["detail"]): { readonly method: string; readonly route: string } | null {
  const method = typeof detail?.method === "string" ? detail.method : "";
  if (typeof detail?.route === "string") return { method, route: detail.route.replace(/:(\w+)/g, "{$1}") };
  if (typeof detail?.path !== "string") return null;
  const path = detail.path;
  const known = TEMPLATES.find((each) => each.method === method && each.pattern.test(path));
  return { method, route: known?.template ?? path.replace(/[0-9a-f-]{36}/g, "{id}") };
}

const CALLS: Readonly<Record<string, Readonly<Partial<Record<string, string>>>>> = {
  "ops.call": CONSOLE_CALLS,
  "client.call": SESSION_CALLS,
  "tech.call": SESSION_CALLS,
};

/** A call that only read: a page opened, a client's record or a visit where it names one. */
function readOf(entry: Entry): string {
  if (entry.subject?.kind === "person") return copy.opened.record;
  if (entry.subject?.kind === "appointment") return copy.opened.visit;
  return copy.opened.page[entry.surface];
}

/** What was done, with the place for the record's name: by the call made, else by the action logged. */
function phraseOf(entry: Entry): string {
  const calls = CALLS[entry.action];
  if (calls !== undefined) {
    const call = routeOf(entry.detail);
    const said = call === null ? undefined : calls[`${call.method} ${call.route}`];
    if (said !== undefined) return said;
    if (call?.method === "GET" || /\/(find|search)$/.test(call?.route ?? "")) return readOf(entry);
  }
  // The log keeps actions an earlier build wrote under names this one no longer has words for.
  return Object.hasOwn(DONE, entry.action) ? DONE[entry.action] : entry.action;
}

/** Who made the entry: a client or a technician by name, with their page; staff by e-mail; a job by its name. */
function whoOf(actor: Entry["actor"]): Named {
  if (actor.kind === "client") return { words: actor.name ?? copy.aClient, opens: { kind: "client", id: actor.id } };
  if (actor.kind === "technician")
    return { words: actor.name ?? actor.id, opens: { kind: "technician", id: actor.id } };
  return { words: actor.name ?? actor.id, opens: null };
}

/** Kinds of record whose own ID says nothing to a reader: a random one. */
const RANDOM = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

/** A client's records, which a client's own entry never names: their words say "their". */
const THEIRS = new Set(["person", "client", "appointment", "visit", "hold", "slot_hold"]);

/** The record an entry touched, as its sentence names it; none where it has no name a reader would know. */
function namedOf(subject: Entry["subject"], actor: Entry["actor"]): Named | null {
  if (subject === null) return null;
  if (actor.kind === "client" && (THEIRS.has(subject.kind) || subject.label === actor.name)) return null;
  const { kind, id, label } = subject;
  if (kind === "person" || kind === "client") return { words: label ?? copy.someClient, opens: { kind: "client", id } };
  if (kind === "appointment" || kind === "visit") {
    return { words: label ?? copy.someClient, opens: { kind: "visit", id } };
  }
  if (kind === "technician") return { words: label ?? copy.someTechnician, opens: { kind: "technician", id } };
  if (kind === "conversation" || kind === "grievance") return { words: label ?? copy.someClient, opens: null };
  if (kind === "leave_request") return { words: label ?? copy.someTechnician, opens: null };
  const words = label ?? (RANDOM.test(id) ? null : id);
  return words === null ? null : { words, opens: null };
}

/** The entry as a sentence. Where the record has no name to give, its place goes, and a word that led to it. */
export function sentenceOf(entry: Entry): Sentence {
  const phrase = phraseOf(entry);
  const who = whoOf(entry.actor);
  const refused = entry.detail?.refused !== undefined;
  const at = phrase.indexOf(PLACE);
  if (at === -1) return { who, before: phrase, named: null, after: "", refused };
  const named = namedOf(entry.subject, entry.actor);
  if (named === null) {
    const before = phrase.slice(0, at).replace(/\s*\b(for|of|on|to|from|with|at|in)?\s*$/, "");
    return { who, before, named: null, after: phrase.slice(at + PLACE.length), refused };
  }
  return { who, before: phrase.slice(0, at), named, after: phrase.slice(at + PLACE.length), refused };
}

/** The sentence as words alone, as the file writes it. */
export const sentenceText = (sentence: Sentence): string =>
  `${sentence.who.words} ${sentence.before}${sentence.named?.words ?? ""}${sentence.after}`.trim();

/** The entries as the file's rows: the sentence, then what a row's details show, one column each. */
export function csvRows(entries: readonly Entry[]): string[][] {
  const columns = copy.columns;
  const head = [
    columns.when,
    columns.who,
    columns.whoIs,
    columns.from,
    columns.what,
    columns.action,
    columns.call,
    columns.record,
    columns.recordId,
    columns.refused,
  ];
  return [
    head,
    ...entries.map((entry) => {
      const sentence = sentenceOf(entry);
      const call = routeOf(entry.detail);
      return [
        `${indiaDate(entry.at)} ${indiaTimeOf(entry.at)}`,
        sentence.who.words,
        copy.filters.kinds[entry.actor.kind],
        copy.surfaces[entry.surface],
        sentenceText(sentence),
        copy.actions[entry.action],
        call === null ? "" : `${call.method} ${call.route}`,
        entry.subject === null ? "" : (copy.kinds[entry.subject.kind] ?? entry.subject.kind),
        entry.subject?.id ?? "",
        sentence.refused ? copy.yes : "",
      ];
    }),
  ];
}
