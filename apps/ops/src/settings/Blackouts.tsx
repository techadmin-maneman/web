// Blackout days: the days no visit is offered, in the app or from the site
// (docs/decisions/0088-every-policy-in-the-console.md). The runbook's SQL set
// them before; no board draws them, so the panel is laid out as Rules is.
//
// The API keeps one row a day. The list shows the days run together where they
// follow one another for the same reason, added by the same press, so each run
// names who added all of it; offering them again sends that run of days back. Blacking out a day moves nothing already booked on it, so
// each run says how many visits are still booked on it, and opens the dispatch board on its first day to move them.

import { Button, buttonLook } from "@maneman/ui/Button";
import { useLoad } from "@maneman/ui/useLoad";
import { addDays, longDate, shortDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { api, type Blackout } from "../api.ts";
import { OpsLink } from "../components/Shell.tsx";
import { settings } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { whoWords } from "../lib/who.ts";
import { dispatchPath } from "../route.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { refusalOf, type Failure } from "./refusal.ts";
import styles from "./settings.module.css";

const copy = settings.blackouts;

/** Days that follow one another for the same reason, added by the same person at the same moment. */
interface Period {
  readonly from: string;
  readonly to: string;
  readonly reason: string;
  readonly setBy: string | null;
  readonly setAt: string | null;
  readonly booked: number;
}

/** Whether a day carries on a run: the next day, for the same reason, added by the same press. */
const carriesOn = (period: Period, day: Blackout): boolean =>
  addDays(period.to, 1) === day.date &&
  period.reason === day.reason &&
  period.setBy === day.set_by &&
  period.setAt === day.set_at;

/** The days, run together where one carries on another. */
function periodsOf(days: readonly Blackout[]): Period[] {
  const periods: Period[] = [];
  for (const day of days) {
    const last = periods.at(-1);
    if (last !== undefined && carriesOn(last, day)) {
      periods[periods.length - 1] = { ...last, to: day.date, booked: last.booked + day.booked };
    } else {
      periods.push({
        from: day.date,
        to: day.date,
        reason: day.reason,
        setBy: day.set_by,
        setAt: day.set_at,
        booked: day.booked,
      });
    }
  }
  return periods;
}

const periodWords = (period: { from: string; to: string }) => copy.period(shortDate(period.from), shortDate(period.to));

/** Who added a run of days and when, or that nobody recorded it. */
function setLine(period: Period): string {
  if (period.setBy === null || period.setAt === null) return copy.unrecorded;
  return copy.setBy(whoWords(period.setBy), longDate(period.setAt));
}

type Draft = { readonly from: string; readonly to: string; readonly reason: string };

const EMPTY: Draft = { from: "", to: "", reason: "" };

function AddForm({ today, onAdded }: { today: string; onAdded: (days: readonly Blackout[]) => void }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<"added" | Failure | null>(null);
  const ready = draft.from !== "" && draft.to !== "" && draft.reason.trim() !== "";

  const send = async () => {
    setSending(true);
    const answer = await api.addBlackouts({ from: draft.from, to: draft.to, reason: draft.reason.trim() });
    setSending(false);
    if (!answer.ok) {
      setOutcome({ code: answer.code, fields: answer.fields });
      return;
    }
    setDraft(EMPTY);
    setOutcome("added");
    onAdded(answer.body.blackouts);
  };
  const edit = (field: keyof Draft, value: string) => {
    setDraft({ ...draft, [field]: value });
    setOutcome(null);
  };

  return (
    <form
      className={styles.group}
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <div className={styles.fields}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="blackout-from">
            {copy.from}
          </label>
          <input
            className={styles.date}
            id="blackout-from"
            type="date"
            min={today}
            value={draft.from}
            onChange={(event) => {
              edit("from", event.target.value);
            }}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="blackout-to">
            {copy.to}
          </label>
          <input
            className={styles.date}
            id="blackout-to"
            type="date"
            min={draft.from === "" ? today : draft.from}
            value={draft.to}
            onChange={(event) => {
              edit("to", event.target.value);
            }}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="blackout-reason">
            {copy.reason}
          </label>
          <input
            className={styles.text}
            id="blackout-reason"
            type="text"
            maxLength={60}
            value={draft.reason}
            onChange={(event) => {
              edit("reason", event.target.value);
            }}
          />
        </div>
      </div>
      <div className={styles.actions}>
        <Button type="submit" variant="primary" size="small" className={styles.save} disabled={!ready || sending}>
          {sending ? copy.adding : copy.add}
        </Button>
      </div>
      {outcome === "added" && (
        <p className={styles.saved} role="status">
          {copy.added}
        </p>
      )}
      {outcome !== null && outcome !== "added" && (
        <p className={styles.error} role="alert">
          {refusalOf(copy.errors, outcome)}
        </p>
      )}
    </form>
  );
}

interface PeriodRowProps {
  readonly period: Period;
  /** Whether the person's access lets them offer the days again. */
  readonly mayRemove: boolean;
  /** Whether it lets them open the dispatch board, where the visits still booked on the days are moved. */
  readonly mayShow: boolean;
  readonly onRemoved: (days: readonly Blackout[]) => void;
}

function PeriodRow({ period, mayRemove, mayShow, onRemoved }: PeriodRowProps) {
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const words = periodWords(period);

  const remove = async () => {
    setSending(true);
    const answer = await api.removeBlackouts({ from: period.from, to: period.to });
    setSending(false);
    if (!answer.ok) {
      setFailure({ code: answer.code, fields: answer.fields });
      return;
    }
    onRemoved(answer.body.blackouts);
  };

  return (
    <li className={styles.rule}>
      <p className={styles.period}>
        {words} · {period.reason}
      </p>
      <p className={styles.set}>{setLine(period)}</p>
      {period.booked > 0 && <p className={styles.checkWarning}>{copy.booked(period.booked)}</p>}
      {period.booked > 0 && mayShow && (
        <div className={styles.actions}>
          <OpsLink
            className={buttonLook({ variant: "outline", size: "small", className: styles.quiet })}
            to={dispatchPath({ from: period.from })}
            label={copy.showLabel(words)}
          >
            {copy.show}
          </OpsLink>
        </div>
      )}
      {mayRemove && (
        <div className={styles.actions}>
          <Button
            variant="outline"
            size="small"
            className={styles.quiet}
            disabled={sending}
            aria-label={copy.removeLabel(words)}
            onClick={() => void remove()}
          >
            {sending ? copy.removing : copy.remove}
          </Button>
        </div>
      )}
      {failure !== null && (
        <p className={styles.error} role="alert">
          {refusalOf(copy.errors, failure)}
        </p>
      )}
    </li>
  );
}

export function Blackouts() {
  const [loaded, retry] = useLoad(api.blackouts);
  /** The days as the last change left them, so the list follows a change without reading it again. */
  const [changed, setChanged] = useState<readonly Blackout[] | null>(null);
  const access = useAccess();
  const mayAdd = access.mayCall("POST /api/blackouts");
  const mayRemove = access.mayCall("POST /api/blackouts/remove");
  const mayShow = access.mayCall("GET /api/dispatch");

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const periods = periodsOf(changed ?? loaded.value.blackouts);

  return (
    <section className={styles.panel} aria-labelledby="blackouts">
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle} id="blackouts">
          {copy.title}
        </h2>
      </div>
      <p className={styles.note}>
        {copy.note}{" "}
        <OpsLink className={styles.link} to={dispatchPath({})}>
          {copy.board}
        </OpsLink>
        .
      </p>
      {mayAdd && <AddForm today={loaded.value.today} onAdded={setChanged} />}
      {periods.length === 0 ? (
        <p className={styles.note}>{copy.none}</p>
      ) : (
        <ul className={styles.rules}>
          {periods.map((period) => (
            <PeriodRow
              key={period.from}
              period={period}
              mayRemove={mayRemove}
              mayShow={mayShow}
              onRemoved={setChanged}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
