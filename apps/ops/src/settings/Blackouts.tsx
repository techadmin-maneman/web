// Blackout days: the days no visit is offered, in the app or from the site
// (docs/decisions/0088-every-policy-in-the-console.md). The runbook's SQL set
// them before; no board draws them, so the panel is laid out as Rules is.
//
// The API keeps one row a day. The list shows the days run together where they
// follow one another for the same reason, and offering them again sends that
// run of days back. Blacking out a day moves nothing already booked on it, so
// each run says how many visits are still booked on it.

import { Button } from "@maneman/ui/Button";
import { useLoad } from "@maneman/ui/useLoad";
import { longDate, shortDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { api, type Blackout } from "../api.ts";
import { settings } from "../content.ts";
import { addDays } from "../dispatch/job.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { refusalOf, type Failure } from "./refusal.ts";
import styles from "./settings.module.css";

const copy = settings.blackouts;

/** Days that follow one another for the same reason, as ops added them. */
interface Period {
  readonly from: string;
  readonly to: string;
  readonly reason: string;
  readonly setBy: string | null;
  readonly setAt: string | null;
  readonly booked: number;
}

/** The days, run together where one follows another for the same reason. */
function periodsOf(days: readonly Blackout[]): Period[] {
  const periods: Period[] = [];
  for (const day of days) {
    const last = periods.at(-1);
    if (last?.reason === day.reason && addDays(last.to, 1) === day.date) {
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
  return copy.setBy(period.setBy, longDate(period.setAt));
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

function PeriodRow({ period, onRemoved }: { period: Period; onRemoved: (days: readonly Blackout[]) => void }) {
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

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} />;
  const periods = periodsOf(changed ?? loaded.value.blackouts);

  return (
    <section className={styles.panel} aria-labelledby="blackouts">
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle} id="blackouts">
          {copy.title}
        </h2>
      </div>
      <p className={styles.note}>{copy.note}</p>
      <AddForm today={loaded.value.today} onAdded={setChanged} />
      {periods.length === 0 ? (
        <p className={styles.note}>{copy.none}</p>
      ) : (
        <ul className={styles.rules}>
          {periods.map((period) => (
            <PeriodRow key={period.from} period={period} onRemoved={setChanged} />
          ))}
        </ul>
      )}
    </section>
  );
}
