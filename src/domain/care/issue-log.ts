// The client's issue log (docs/decisions/0258-the-issue-log.md): each report with its state and its thread, read from
// the rows that exist; and their grievances and missed-visit disputes beside them, each with its own state.
//
// A report's thread is its own words, then what the client's Care chats hold from it until their next report: Care's
// replies, under the first name the client knows them by, the client's own later words, a City matter passed on, free
// visits given, and Care closing the chat or the client marking it sorted. A chat is read only while the client held
// its number, so the thread follows them across a change of number and never shows another's words.

import { reportNumberOf, reportReference, type ProblemCategory } from "../../policy/problems.ts";
import { AUTO_REPLY } from "./after-hours.ts";

export type IssueState = "open" | "in_progress" | "resolved";

export interface IssueEvent {
  readonly at: string;
  /**
   * you: the client's words; care: a reply; city: passed to the client's city team; visits: free visits given; closed:
   * Care closed the chat; sorted: the client marked it sorted; ruled: a dispute's or a grievance's answer.
   */
  readonly kind: "you" | "care" | "city" | "visits" | "closed" | "sorted" | "ruled";
  /** The first name Care's reply came from; null for anything else, or a reply from one with none set. */
  readonly name: string | null;
  /** Words, where the event has them: what was written, the visits given, or the ruling. */
  readonly text: string | null;
}

export interface Issue {
  readonly kind: "report" | "grievance" | "dispute";
  readonly id: string;
  /** A report's reference, as MM-ISS-0032; null for a grievance or a dispute. */
  readonly reference: string | null;
  readonly category: ProblemCategory | null;
  readonly state: IssueState;
  readonly raised_at: string;
  readonly visit_id: string | null;
  readonly text: string | null;
  readonly photos: number;
  readonly events: IssueEvent[];
}

/** How many of each kind the log reads, newest first. */
const LOG_LIMIT = 50;

interface ReportRow {
  id: string;
  number: number;
  category: ProblemCategory;
  visit_id: string | null;
  text: string | null;
  conversation_id: string | null;
  created_at: string;
  closed_at: string | null;
  sorted_at: string | null;
  reopened_at: string | null;
  photos: number;
}

interface ThreadRow {
  conversation_id: string;
  direction: "in" | "out";
  text: string | null;
  sent_at: string;
  name: string | null;
}

interface Passed {
  raised_at: string;
}

interface Given {
  visits: number;
  given_at: string;
}

/** The stretch of the client's chats a report holds: from it until their next report, by number. */
function spanOf(report: ReportRow, reports: readonly ReportRow[]): { from: string; to: string | null } {
  const next = reports.filter((other) => other.number > report.number).sort((a, b) => a.number - b.number)[0];
  return { from: report.created_at, to: next?.created_at ?? null };
}

const within = (at: string, span: { from: string; to: string | null }) =>
  at > span.from && (span.to === null || at < span.to);

/** Words the client sent to a report from the app carry its reference: "MM-ISS-0032 · Update:\n…". */
const NAMED = /^(MM-ISS-\d{4,}) · [^:\n]+:\n([\s\S]*)$/;

/** The report a message of the client's names, and its words without the heading; null for words naming none. */
function namedIn(text: string | null): { readonly number: number; readonly words: string } | null {
  const match = NAMED.exec(text ?? "");
  const number = reportNumberOf(match?.[1] ?? "");
  return match === null || number === null ? null : { number, words: match[2] ?? "" };
}

/**
 * Resolved once closed or marked sorted with nothing from the client since, in the app or the chat; in progress once
 * Care did anything; open until then.
 */
function stateOf(report: ReportRow, events: readonly IssueEvent[]): IssueState {
  const settled = [report.closed_at, report.sorted_at]
    .filter((at): at is string => at !== null)
    .sort()
    .at(-1);
  const lastWords = [
    report.reopened_at,
    ...events.filter((e) => e.kind === "you" && e.at > report.created_at).map((e) => e.at),
  ]
    .filter((at): at is string => at !== null)
    .sort()
    .at(-1);
  if (settled !== undefined && (lastWords === undefined || settled > lastWords)) return "resolved";
  return events.some((event) => event.kind === "care" || event.kind === "city" || event.kind === "visits")
    ? "in_progress"
    : "open";
}

function reportIssue(
  report: ReportRow,
  reports: readonly ReportRow[],
  rows: { thread: readonly ThreadRow[]; passed: readonly Passed[]; given: readonly Given[] },
): Issue {
  const span = spanOf(report, reports);
  const words: IssueEvent = { at: report.created_at, kind: "you", name: null, text: report.text };
  // The client's words go to the report they name, wherever they fall; the rest of their chats by its stretch.
  const mine = (row: ThreadRow): boolean => {
    const named = row.direction === "in" ? namedIn(row.text) : null;
    if (named === null) return within(row.sent_at, span);
    return named.number === report.number && row.sent_at > report.created_at;
  };
  const events: IssueEvent[] = [
    words,
    ...rows.thread.filter(mine).map((row): IssueEvent => {
      const fromCare = row.direction === "out";
      const text = fromCare ? row.text : (namedIn(row.text)?.words ?? row.text);
      return { at: row.sent_at, kind: fromCare ? "care" : "you", name: fromCare ? row.name : null, text };
    }),
    ...rows.passed
      .filter((row) => within(row.raised_at, span))
      .map((row): IssueEvent => ({ at: row.raised_at, kind: "city", name: null, text: null })),
    ...rows.given
      .filter((row) => within(row.given_at, span))
      .map((row): IssueEvent => ({ at: row.given_at, kind: "visits", name: null, text: String(row.visits) })),
    ...(report.closed_at === null ? [] : [{ at: report.closed_at, kind: "closed", name: null, text: null } as const]),
    ...(report.sorted_at === null ? [] : [{ at: report.sorted_at, kind: "sorted", name: null, text: null } as const]),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return {
    kind: "report",
    id: report.id,
    reference: reportReference(report.number),
    category: report.category,
    state: stateOf(report, events),
    raised_at: report.created_at,
    visit_id: report.visit_id,
    text: report.text,
    photos: report.photos,
    events,
  };
}

async function reportsOf(db: D1Database, personId: string): Promise<Issue[]> {
  const { results: reports } = await db
    .prepare(
      `SELECT r.id, r.number, r.category, r.visit_id, r.text, r.conversation_id, r.created_at, r.closed_at, r.sorted_at,
              r.reopened_at, (SELECT COUNT(*) FROM client_report_photos p WHERE p.report_id = r.id) AS photos
         FROM client_reports r
        WHERE r.person_id = ?1
        ORDER BY r.created_at DESC
        LIMIT ${String(LOG_LIMIT)}`,
    )
    .bind(personId)
    .all<ReportRow>();
  const oldest = reports.at(-1)?.created_at;
  if (oldest === undefined) return [];
  const [thread, passed, given] = await db.batch([
    db
      .prepare(
        `SELECT m.conversation_id, m.direction, m.text, m.sent_at, cn.name
           FROM conversations c
           JOIN chat_messages m ON m.conversation_id = c.id
           LEFT JOIN care_names cn ON cn.email = m.author
          -- The chats on every number the client has held: the one they hold now, and each a change took them to or
          -- from.
          WHERE c.mobile_e164 IN (SELECT pe.mobile_e164 FROM people pe WHERE pe.id = ?1
                                  UNION SELECT n.new_mobile_e164 FROM number_change_requests n
                                         WHERE n.person_id = ?1 AND n.state = 'confirmed'
                                  UNION SELECT n.replaced_mobile_e164 FROM number_change_requests n
                                         WHERE n.person_id = ?1 AND n.state = 'confirmed')
            AND m.direction IN ('in', 'out') AND m.sent_at > ?2
            -- The after-hours answer is no reply from Care (docs/decisions/0133-the-after-hours-reply.md).
            AND m.author <> ?3
            -- Only while the client held the chat's number: the one the last change before the message took them to, or
            -- before any change, the one they started on. Before and after, the number was or may be another's.
            AND c.mobile_e164 = COALESCE(
                  (SELECT n.new_mobile_e164 FROM number_change_requests n
                    WHERE n.person_id = ?1 AND n.state = 'confirmed' AND n.decided_at <= m.sent_at
                    ORDER BY n.decided_at DESC LIMIT 1),
                  -- The number a first change replaced, where one was; a change that kept none reads nothing before it.
                  CASE WHEN EXISTS (SELECT 1 FROM number_change_requests n
                                     WHERE n.person_id = ?1 AND n.state = 'confirmed')
                       THEN (SELECT n.replaced_mobile_e164 FROM number_change_requests n
                              WHERE n.person_id = ?1 AND n.state = 'confirmed' ORDER BY n.decided_at LIMIT 1)
                       ELSE (SELECT pe.mobile_e164 FROM people pe WHERE pe.id = ?1) END)
          ORDER BY m.sent_at`,
      )
      .bind(personId, oldest, AUTO_REPLY),
    db.prepare("SELECT raised_at FROM city_matters WHERE person_id = ?1 AND raised_at > ?2").bind(personId, oldest),
    db
      .prepare("SELECT visits, given_at FROM remedies WHERE person_id = ?1 AND state = 'given' AND given_at > ?2")
      .bind(personId, oldest),
  ]);
  const rows = {
    thread: (thread?.results ?? []) as ThreadRow[],
    passed: (passed?.results ?? []) as Passed[],
    given: (given?.results ?? []) as Given[],
  };
  return reports.map((report) => reportIssue(report, reports, rows));
}

interface GrievanceRow {
  id: string;
  text: string | null;
  state: string;
  response: string | null;
  resolved_at: string | null;
  created_at: string;
}

interface DisputeRow {
  id: string;
  reason: string | null;
  created_at: string;
  ruling: string | null;
  ruled_at: string | null;
  appointment_id: string | null;
}

/** The client's grievances and missed-visit disputes, each answered or still open. */
async function othersOf(db: D1Database, personId: string): Promise<Issue[]> {
  const [grievances, disputes] = await db.batch([
    db
      .prepare(
        `SELECT id, text, state, response, resolved_at, created_at FROM grievances WHERE person_id = ?1
          ORDER BY created_at DESC LIMIT ${String(LOG_LIMIT)}`,
      )
      .bind(personId),
    db
      .prepare(
        `SELECT d.id, d.reason, d.created_at, d.ruling, d.ruled_at, n.appointment_id
           FROM no_show_disputes d JOIN no_show_cases n ON n.id = d.case_id
          WHERE d.person_id = ?1 ORDER BY d.created_at DESC LIMIT ${String(LOG_LIMIT)}`,
      )
      .bind(personId),
  ]);
  const ruled = (at: string | null, text: string | null): IssueEvent[] =>
    at === null ? [] : [{ at, kind: "ruled", name: null, text }];
  const asked = (at: string, text: string | null): IssueEvent => ({ at, kind: "you", name: null, text });
  return [
    ...((grievances?.results ?? []) as GrievanceRow[]).map((row): Issue => ({
      kind: "grievance",
      id: row.id,
      reference: null,
      category: null,
      state: row.state === "resolved" ? "resolved" : "open",
      raised_at: row.created_at,
      visit_id: null,
      text: row.text,
      photos: 0,
      events: [asked(row.created_at, row.text), ...ruled(row.resolved_at, row.response)],
    })),
    ...((disputes?.results ?? []) as DisputeRow[]).map((row): Issue => ({
      kind: "dispute",
      id: row.id,
      reference: null,
      category: null,
      state: row.ruling === null ? "open" : "resolved",
      raised_at: row.created_at,
      visit_id: row.appointment_id,
      text: row.reason,
      photos: 0,
      events: [asked(row.created_at, row.reason), ...ruled(row.ruled_at, row.ruling)],
    })),
  ];
}

/**
 * The client's reports their log reads open or in progress, latest first: what Care's close of the chat on their number
 * settles, and the one its reason opens on. The newest fifty, as the log reads them.
 */
export async function openReportsOf(db: D1Database, personId: string): Promise<Issue[]> {
  const number = (issue: Issue) => reportNumberOf(issue.reference ?? "") ?? 0;
  return (await reportsOf(db, personId))
    .filter((issue) => issue.state !== "resolved")
    .sort((a, b) => number(b) - number(a));
}

/** Everything in the client's issue log, newest first. */
export async function issueLogOf(db: D1Database, personId: string): Promise<Issue[]> {
  const [reports, others] = await Promise.all([reportsOf(db, personId), othersOf(db, personId)]);
  return [...reports, ...others].sort((a, b) => b.raised_at.localeCompare(a.raised_at));
}
