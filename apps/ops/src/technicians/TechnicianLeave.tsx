// A technician's Leave tab: his leave still to end, each period with the jobs still booked on its days, and the form
// that records more. Its days are refused to self-serve booking and to the dispatch board alike, which is why the
// form says so before it is sent. Leave moves none of the jobs already booked: each waits on the Tasks board until
// ops move it, and "Show on board" opens the board on that job's week, with his row in view and the job's drawer open.

import { Button } from "@maneman/ui/Button";
import { failedRequestId, useLoad } from "@maneman/ui/useLoad";
import { fullDate, indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { useCallback, useState } from "react";
import { api, type JobOnLeave, type StandingLeave, type TechnicianSummary } from "../api.ts";
import { OpsLink } from "../components/Shell.tsx";
import { technicians } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { dispatchPath } from "../route.ts";
import { CheckPanel } from "../settings/CheckPanel.tsx";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "./technicians.module.css";

const copy = technicians.leave;

/** "19 Sep 2026 to 23 Sep 2026", or one date on its own. */
const periodOf = (leave: StandingLeave) => copy.period(fullDate(leave.from), fullDate(leave.to));

/** Why it was refused, in the console's words; nothing changed either way. */
function refusal(code: string): string {
  const errors: Readonly<Record<string, string | undefined>> = copy.errors;
  return errors[code] ?? copy.errors.unknown;
}

function StrandedJob({ job, technician }: { job: JobOnLeave; technician: TechnicianSummary }) {
  const words = copy.stranded;
  const when = `${shortDate(indiaDate(job.starts_at))}, ${indiaClock(job.starts_at)}`;
  const client = job.client ?? words.noClient;
  const onBoard = dispatchPath({ from: indiaDate(job.starts_at), find: technician.name, visit: job.appointment_id });
  return (
    <li className={styles.jobRow}>
      <span>{words.job(when, client)}</span>
      <OpsLink className={styles.show} to={onBoard} label={words.showLabel(when, client)}>
        {words.show}
      </OpsLink>
    </li>
  );
}

/** The jobs still booked on a period's days, behind the oxblood rule the console gives what needs doing. */
function Stranded({ jobs, technician }: { jobs: readonly JobOnLeave[]; technician: TechnicianSummary }) {
  return (
    <div className={styles.stranded}>
      <p className={styles.strandedTitle}>{copy.stranded.title(jobs.length)}</p>
      <ul className={styles.leaveList}>
        {jobs.map((job) => (
          <StrandedJob key={job.appointment_id} job={job} technician={technician} />
        ))}
      </ul>
    </div>
  );
}

type TakingBack = "listed" | "checking" | "sending";

function Period({
  leave,
  technician,
  onTakenBack,
}: {
  leave: StandingLeave;
  technician: TechnicianSummary;
  onTakenBack: () => Promise<void>;
}) {
  const [step, setStep] = useState<TakingBack>("listed");
  const [failed, setFailed] = useState<string | null>(null);
  const mayTakeBack = useAccess().mayCall("POST /api/technicians/{id}/leave/{leave}/cancel");
  const period = periodOf(leave);

  const takeBack = async () => {
    setStep("sending");
    setFailed(null);
    const answer = await api.cancelLeave(technician.id, leave.id);
    if (!answer.ok) {
      setStep("checking");
      setFailed(refusal(answer.code));
      return;
    }
    await onTakenBack();
  };

  return (
    <li className={styles.period}>
      <div className={styles.leaveRow}>
        <span className={styles.leavePeriod}>{period}</span>
        {leave.note !== null && <span className={styles.leaveNote}>{leave.note}</span>}
        {mayTakeBack && step === "listed" && (
          <Button
            variant="outline"
            size="small"
            className={styles.quiet}
            aria-label={copy.takeLabel(period, technician.name)}
            onClick={() => {
              setStep("checking");
            }}
          >
            {copy.take}
          </Button>
        )}
      </div>
      {step !== "listed" && (
        <CheckPanel
          title={copy.check.title(period)}
          lines={[copy.check.line]}
          send={copy.check.send}
          sending={copy.check.sending}
          back={copy.check.back}
          busy={step === "sending"}
          onSend={() => void takeBack()}
          onBack={() => {
            setStep("listed");
            setFailed(null);
          }}
        />
      )}
      {leave.jobs.length > 0 && <Stranded jobs={leave.jobs} technician={technician} />}
      {failed !== null && (
        <p className={styles.error} role="alert">
          {failed}
        </p>
      )}
    </li>
  );
}

interface Entry {
  readonly from: string;
  readonly to: string;
  readonly note: string;
}

function LeaveForm({
  technician,
  onRecorded,
  onCancel,
}: {
  technician: TechnicianSummary;
  onRecorded: () => Promise<void>;
  onCancel: () => void;
}) {
  const [entry, setEntry] = useState<Entry>({ from: "", to: "", note: "" });
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const send = async () => {
    setSending(true);
    setFailed(null);
    const note = entry.note.trim();
    const answer = await api.recordLeave(technician.id, {
      from: entry.from,
      to: entry.to,
      note: note === "" ? null : note,
    });
    if (!answer.ok) {
      setSending(false);
      setFailed(refusal(answer.code));
      return;
    }
    await onRecorded();
  };

  return (
    <form
      className={styles.leaveForm}
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <p className={styles.warning}>{copy.effect}</p>
      <div className={styles.fields}>
        <label className={styles.field}>
          <span className={styles.label}>{copy.from}</span>
          <input
            className={styles.input}
            type="date"
            required
            // The form opens where the button that asked for it stood, so the keyboard goes to its first field.
            autoFocus
            value={entry.from}
            onChange={(event) => {
              setEntry({ ...entry, from: event.target.value });
            }}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{copy.to}</span>
          <input
            className={styles.input}
            type="date"
            required
            value={entry.to}
            onChange={(event) => {
              setEntry({ ...entry, to: event.target.value });
            }}
          />
        </label>
      </div>
      <label className={styles.field}>
        <span className={styles.label}>{copy.note}</span>
        <input
          className={styles.input}
          type="text"
          maxLength={200}
          value={entry.note}
          onChange={(event) => {
            setEntry({ ...entry, note: event.target.value });
          }}
        />
      </label>
      <div className={styles.actions}>
        <Button variant="primary" size="small" className={styles.save} type="submit" disabled={sending}>
          {sending ? copy.saving : copy.save}
        </Button>
        <Button variant="outline" size="small" className={styles.quiet} disabled={sending} onClick={onCancel}>
          {copy.cancel}
        </Button>
      </div>
      {failed !== null && (
        <p className={styles.error} role="alert">
          {failed}
        </p>
      )}
    </form>
  );
}

/** Read when the tab opens and again after every change, since the dispatch board reads the same rows. */
export function Leave({ technician }: { technician: TechnicianSummary }) {
  const load = useCallback(() => api.standingLeave(technician.id), [technician.id]);
  const [loaded, retry] = useLoad(load);
  const [fresh, setFresh] = useState<readonly StandingLeave[] | null>(null);
  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const mayRecord = useAccess().mayCall("POST /api/technicians/{id}/leave");

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={failedRequestId(loaded)} />;

  const leave = fresh ?? loaded.value.leave;
  const readAgain = async () => {
    const answer = await api.standingLeave(technician.id);
    if (answer.ok) setFresh(answer.body.leave);
  };

  return (
    <>
      {leave.length === 0 ? (
        <p className={styles.none}>{copy.none}</p>
      ) : (
        <ul className={styles.leaveList}>
          {leave.map((period) => (
            <Period key={period.id} leave={period} technician={technician} onTakenBack={readAgain} />
          ))}
        </ul>
      )}
      {recorded && (
        <p className={styles.notice} role="status">
          {copy.recorded}
        </p>
      )}
      {!recording && mayRecord && (
        <div className={styles.actions}>
          <Button
            variant="outline"
            size="small"
            className={styles.quiet}
            aria-label={copy.addLabel(technician.name)}
            onClick={() => {
              setRecorded(false);
              setRecording(true);
            }}
          >
            {copy.add}
          </Button>
        </div>
      )}
      {recording && (
        <LeaveForm
          technician={technician}
          onRecorded={async () => {
            await readAgain();
            setRecording(false);
            setRecorded(true);
          }}
          onCancel={() => {
            setRecording(false);
          }}
        />
      )}
    </>
  );
}
