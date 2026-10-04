// Tasks (Ops Console, board D2): what ops still have to do, in groups, with whose
// each is and how long it has left. Nothing is decided here. A task is a row in a queue the
// database already keeps — a consultation asked for, a held grant, an
// undecided no-show, a disputed charge, a number change, an erasure, a grievance, a piece past its
// replacement date, an invoice still a draft, an erasure FSM would not finish,
// a moved visit whose client has not heard of it, a booking FSM refused, a visit left partly done, a
// visit to come with no address, a job on its technician's day off, a client
// past their next service with nothing booked, a first fit asked for and not
// booked, a one visit's payment still owed — so it leaves the list when that row
// is decided, on the section that decides it, when the client books, or when
// they pay (src/policy/tasks.ts).
//
// Each task leads to where it is done: the client's page, and the row in the
// section that decides it; a task the dispatch board settles opens its visit's
// drawer there. A consultation asked for, a first fit to book and a replacement
// due are booked from the row itself (BookFromTask.tsx), and the call about a move
// is recorded there too (CallAboutMove.tsx). Each group's count is the whole
// queue's, and a group longer than the board lists says so.
//
// The board writes an owner in ops against every task, in its own column. Ops
// take a task, give it to another member of staff or hand it back, and close a
// visit left partly done without a follow-up, from the row (TaskActions.tsx;
// docs/decisions/0092-task-owners.md).
//
// Above the tasks, "Needs a hand" lists the alerts ops were told of and not yet
// put right (NeedsAHand.tsx).

import { useLoad } from "@maneman/ui/useLoad";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { fullDate, indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useRef, useState } from "react";
import type { Task, TaskGroup, Tasks } from "../api.ts";
import { OpsLink, Shell } from "../components/Shell.tsx";
import { dispatch, referrals, tasks } from "../content.ts";
import { taskNeed, useAccess, whoami } from "../lib/access.ts";
import { daysUntil } from "../lib/due.ts";
import { readTasks } from "../lib/waiting.ts";
import { rowPath } from "../lib/target.ts";
import { dispatchPath, type ClientTab } from "../route.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { BookFromTask } from "./BookFromTask.tsx";
import { CallAboutMove } from "./CallAboutMove.tsx";
import { DECIDED_IN } from "./decided.ts";
import { NeedsAHand } from "./NeedsAHand.tsx";
import { TaskActions } from "./TaskActions.tsx";
import styles from "./tasks.module.css";

type Group = TaskGroup["group"];

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The fraud rules, as board C1 letters them: a held grant is the same grant on both boards. */
const SIGNALS: Readonly<Record<string, string>> = referrals.queue.signals;

/** The tab of the client's page each group is about; the page opens on Pieces otherwise. */
const CLIENT_TAB: Partial<Record<Group, ClientTab>> = {
  untold_move: "visits",
  // Booked in FSM, linked, or refunded from the Visits tab (docs/decisions/0095-a-booking-fsm-refuses-is-held.md).
  held_booking: "visits",
  leave_conflict: "visits",
  address_to_confirm: "visits",
  consultation_request: "visits",
  first_fit_to_book: "visits",
  replacement_order: "pieces",
  at_risk_client: "visits",
  partial_visit: "visits",
  no_show_decision: "visits",
  no_show_dispute: "visits",
  draft_invoice: "payments",
  payment_owed: "payments",
};

/** The board opened on the week of the task's visit, with its drawer open; this week's board for a task with none. */
function onTheBoard(task: Task): string {
  if (task.visit === undefined) return dispatchPath({});
  return dispatchPath({ from: indiaDate(task.visit.starts_at), visit: task.visit.id });
}

function decidedAt(group: Group, task: Task): string | null {
  const where = DECIDED_IN[group];
  if (where === undefined) return null;
  if (where.page === "/dispatch") return onTheBoard(task);
  return where.row === null ? where.page : rowPath(where.page, where.row, task.id);
}

function clientPath(group: Group, personId: string): string {
  const tab = CLIENT_TAB[group];
  return tab === undefined ? `/clients/${personId}` : `/clients/${personId}/${tab}`;
}

/** A window's name, as the dispatch board writes it, for the window a first fit was asked for in; null for either. */
const fitWindow = (window: string | undefined): string | null =>
  window === undefined || window === "any" ? null : (dispatch.windows[window] ?? window);

/** Whole weeks from one instant to another. */
const weeksBetween = (from: string, to: Date): number => Math.floor((to.getTime() - Date.parse(from)) / WEEK_MS);

/** Where a payment link still owed stands; a word the board does not know reads as not sent. */
function linkOwed(word: string): "sent" | "unsent" | "closed" {
  if (word === "sent" || word === "closed") return word;
  return "unsent";
}

/** The second line: the one fact the group turns on. */
function subOf(group: Group, task: Task, now: Date): string {
  const copy = tasks.subs;
  if (group === "untold_move") {
    // The start the visit moved to.
    return task.detail === null
      ? tasks.unknown
      : copy.untold_move(`${shortDate(indiaDate(task.detail))}, ${indiaClock(task.detail)}`);
  }
  if (group === "held_booking") {
    // The visit's kind, its day and its window, as the booking held them.
    const [type = "", day = "", when = ""] = task.detail?.split(" ") ?? [];
    if (day === "") return tasks.unknown;
    return copy.held_booking(dispatch.typeNames[type] ?? type, shortDate(day), dispatch.windows[when] ?? when);
  }
  if (group === "leave_conflict") {
    // The job's start, then the technician who is away that day.
    const [start = "", ...technician] = task.detail?.split(" ") ?? [];
    if (start === "") return tasks.unknown;
    return copy.leave_conflict(`${shortDate(indiaDate(start))}, ${indiaClock(start)}`, technician.join(" "));
  }
  if (group === "address_to_confirm") {
    // The visit's start.
    return task.detail === null
      ? tasks.unknown
      : copy.address_to_confirm(`${shortDate(indiaDate(task.detail))}, ${indiaClock(task.detail)}`);
  }
  if (group === "consultation_request") {
    // The day and the window, as the request recorded them: both are always there. Then the first fit, where the
    // site's form asked for it too, and the window it was wanted in; or the one visit, and its discount code.
    const [day = "", when = "", plan, fitInOrCode] = task.detail?.split(" ") ?? [];
    const asked = copy.consultation_request(fullDate(indiaDate(day)), dispatch.windows[when] ?? when);
    if (plan === "one_visit") {
      return `${asked} ${copy.withOneVisit}${fitInOrCode === undefined ? "" : copy.withCode(fitInOrCode)}`;
    }
    return plan === "first_fit" ? `${asked} ${copy.withFirstFit(fitWindow(fitInOrCode))}` : asked;
  }
  if (group === "first_fit_to_book") {
    // The consultation's start, and the window the fit was asked for in.
    const [consulted = "", fitIn] = task.detail?.split(" ") ?? [];
    if (consulted === "") return tasks.unknown;
    return copy.first_fit_to_book(shortDate(indiaDate(consulted)), fitWindow(fitIn));
  }
  if (group === "at_risk_client") {
    // The last visit's start, and the day its next service fell due.
    const [last = "", due = ""] = task.detail?.split(" ") ?? [];
    if (last === "" || due === "") return tasks.unknown;
    return copy.at_risk_client(weeksBetween(last, now), shortDate(due));
  }
  if (group === "replacement_order") {
    return copy.replacement_order(task.detail ?? tasks.unknown, fullDate(indiaDate(task.since)));
  }
  if (group === "partial_visit") {
    // The technician's reason, in the job sheet's words, and the day he closed the visit.
    const reason = task.detail ?? copy.noReason;
    return copy.partial_visit(reason, shortDate(indiaDate(task.since)));
  }
  if (group === "referral_review") return SIGNALS[task.detail ?? ""] ?? copy.unknown;
  if (group === "no_show_decision") return task.detail === null ? copy.unknown : copy.no_show_decision(task.detail);
  if (group === "no_show_dispute") return copy.no_show_dispute(disputedTook(task.detail));
  if (group === "draft_invoice") return copy.draft_invoice(shortDate(indiaDate(task.since)));
  if (group === "payment_owed") {
    // Whether Razorpay sent the link or it closed unpaid, what it asks for in paise, and the product, by name.
    const [link = "", amount = "", ...product] = task.detail?.split(" ") ?? [];
    if (amount === "") return tasks.unknown;
    return copy.payment_owed(product.join(" "), rupees(Number(amount)), linkOwed(link));
  }
  if (group === "erasure_unfinished") return copy.erasure_unfinished(task.detail ?? tasks.unknown);
  if (group === "grievance") return copy.grievance;
  return group === "number_change" ? copy.number_change : copy.erasure_request;
}

/** What a disputed charge kept: its amount in paise, or, where it kept no money, the credit it spent. */
function disputedTook(kept: string | null): string {
  const amount = Number(kept ?? "0");
  return amount > 0 ? rupees(amount) : tasks.subs.disputedCredit;
}

/**
 * The first line of a task with no client to name: an erased client has no
 * name left, so the day they were erased heads an erasure FSM would not
 * finish, the visit heads a no-show, and a disputed charge says only that.
 */
function unnamedSubject(group: Group, task: Task): string {
  if (group === "no_show_dispute") return tasks.disputeErased;
  const day = shortDate(indiaDate(task.since));
  return group === "erasure_unfinished" ? tasks.erased(day) : tasks.visit(day);
}

/** "priya.sharma@maneman.in" reads "Priya", as the board names an owner in ops by their first name. */
function ownerName(email: string): string {
  const [first = email] = (email.split("@")[0] ?? email).split(/[._-]+/);
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/** How long is left to answer: the days over, today, or the days left. */
function slaText(days: number): string {
  if (days < 0) return tasks.sla.over(-days);
  if (days === 0) return tasks.sla.today;
  return tasks.sla.left(days);
}

/**
 * What the row's actions need beyond the task: who is signed in, who a task may be given to, what their access lets
 * them do with it, and what changed.
 */
interface Acting {
  readonly me: string | null;
  readonly staff: readonly string[];
  /** Whether they may take it, give it or hand it back: Act in the department that decides its group. */
  readonly mayOwn: boolean;
  /** Whether they may close it without a follow-up: a group that allows it, and access that reaches it. */
  readonly closable: boolean;
  readonly owner: string | null;
  readonly onOwner: (owner: string | null) => void;
  readonly onClosed: () => void;
}

function Row({ group, task, now, acting }: { group: Group; task: Task; now: Date; acting: Acting }) {
  const days = daysUntil(task.due, now);
  const overdue = days < 0;
  const sla = slaText(days);
  const subject = task.person?.name ?? unnamedSubject(group, task);
  const where = decidedAt(group, task);
  const action = tasks.decide[group];
  const { owner } = acting;

  return (
    <li className={styles.task}>
      <div className={styles.what}>
        {task.person === null ? (
          <span className={styles.subject}>{subject}</span>
        ) : (
          <OpsLink className={styles.subject} to={clientPath(group, task.person.id)}>
            {subject}
          </OpsLink>
        )}
        <span className={styles.sub}>{subOf(group, task, now)}</span>
        {where !== null && action !== undefined && (
          <span className={styles.sub}>
            <OpsLink className={styles.decide} to={where}>
              {action}
              {/* Every row of a group links the same words, so each says whose it is to a screen reader. */}
              <VisuallyHidden>{` · ${subject}`}</VisuallyHidden>
            </OpsLink>
          </span>
        )}
        <BookFromTask group={group} task={task} subject={subject} onBooked={acting.onClosed} />
        <CallAboutMove group={group} task={task} subject={subject} onTold={acting.onClosed} />
        <TaskActions group={group} task={task} subject={subject} {...acting} />
      </div>
      <span className={styles.owner}>
        <VisuallyHidden>{tasks.owner.label}</VisuallyHidden>
        {owner === null ? <VisuallyHidden>{tasks.owner.nobody}</VisuallyHidden> : ownerName(owner)}
      </span>
      <span className={`${styles.sla ?? ""} ${overdue ? (styles.late ?? "") : ""}`}>{sla}</span>
    </li>
  );
}

/** A task by its group and its row's id, as the API names it. */
const keyOf = (group: Group, task: Task) => `${group}/${task.id}`;

/**
 * The board as it was read, less the tasks closed here since, with their groups' counts and the overdue count: the
 * list follows what ops close on it without being read again.
 */
function sinceRead(board: Tasks, closed: readonly string[], now: Date): Tasks {
  const groups = board.groups
    .map((each) => {
      const left = each.tasks.filter((task) => !closed.includes(keyOf(each.group, task)));
      return { ...each, count: each.count - (each.tasks.length - left.length), tasks: left };
    })
    .filter((each) => each.count > 0);
  const closedOverdue = board.groups.flatMap((each) =>
    each.tasks.filter((task) => closed.includes(keyOf(each.group, task)) && daysUntil(task.due, now) < 0),
  );
  return { ...board, overdue: board.overdue - closedOverdue.length, groups };
}

function Queue() {
  const [loaded, retry] = useLoad(readTasks);
  const [signedIn] = useLoad(whoami);
  const access = useAccess();
  const [owners, setOwners] = useState<ReadonlyMap<string, string | null>>(new Map());
  const [closed, setClosed] = useState<readonly string[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;

  const now = new Date();
  const me = signedIn.state === "loaded" ? signedIn.value.signed_in_as : null;
  const { overdue, truncated, staff, groups } = sinceRead(loaded.value, closed, now);
  const actingOn = (group: TaskGroup, task: Task): Acting => {
    const key = keyOf(group.group, task);
    const changed = owners.get(key);
    return {
      me,
      staff,
      mayOwn: access.reaches(taskNeed(group.group, "act")),
      closable: group.closable && access.mayCall("POST /api/tasks/{group}/{id}/close"),
      owner: changed === undefined ? task.owner : changed,
      onOwner: (owner) => {
        setOwners((was) => new Map(was).set(key, owner));
      },
      onClosed: () => {
        setClosed((was) => [...was, key]);
        // The row is gone, so the keyboard goes to the list's heading rather than to the top of the page.
        heading.current?.focus();
      },
    };
  };
  return (
    <section className={styles.panel} aria-labelledby="tasks">
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle} id="tasks" ref={heading} tabIndex={-1}>
          {tasks.title}
        </h2>
        <span className={styles.overdue}>{tasks.overdue(overdue)}</span>
      </div>
      {truncated && <p className={styles.note}>{tasks.truncated}</p>}
      {groups.length === 0 ? (
        <p className={styles.empty}>{tasks.empty}</p>
      ) : (
        groups.map((group) => (
          <div className={styles.group} key={group.group}>
            <div className={styles.groupHead}>
              <h3 className={styles.groupName}>{tasks.groups[group.group]}</h3>
              <span className={styles.count}>{group.count}</span>
            </div>
            <ul className={styles.tasks}>
              {group.tasks.map((task) => (
                <Row key={task.id} group={group.group} task={task} now={now} acting={actingOn(group, task)} />
              ))}
            </ul>
            {group.count > group.tasks.length && (
              <p className={styles.shown}>{tasks.shown(group.tasks.length, group.count)}</p>
            )}
          </div>
        ))
      )}
      <p className={styles.note}>{tasks.note}</p>
    </section>
  );
}

export function TasksScreen() {
  return (
    <Shell section="/tasks" title={tasks.title}>
      <div className={styles.column}>
        <NeedsAHand />
        <Queue />
      </div>
    </Shell>
  );
}
