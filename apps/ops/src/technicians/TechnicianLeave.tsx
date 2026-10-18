// A technician's Leave tab: their leave still to end, each period with the jobs still booked on its days, and the form
// that records more. Its days are refused to self-serve booking and to the dispatch board alike, which is why the
// form says so before it is sent. Leave moves none of the jobs already booked: each waits on the Tasks board until
// ops move it, and "Show on board" opens the board on that job's week, with their row in view and the job's drawer open.

import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { EmptyState } from "@maneman/ui/EmptyState";
import { Checkbox, DateInput, Field, TextInput } from "@maneman/ui/Field";
import { Button } from "@maneman/ui/Button";
import { failedRequestId, useLoad } from "@maneman/ui/useLoad";
import { dayClock, fullDate, indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { useCallback, useState } from "react";
import { type JobOnLeave, type StandingLeave, type TechnicianSummary } from "../api.ts";
import { OpsLink } from "../components/Shell.tsx";
import { technicians } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { dispatchPath } from "../route.ts";
import { CheckPanel } from "../components/CheckPanel.tsx";
import { Loading, PanelFailed } from "../states/States.tsx";
import shared from "./technicians.module.css";
import styles from "./technician-leave.module.css";
import { Refusal } from "../components/Refusal.tsx";
import { techniciansApi } from "./technicians-api.ts";
import { TimeField } from "./TechnicianHours.tsx";

const copy = technicians.leave;

/** "19 Sep 2026 to 23 Sep 2026", one date on its own, or one date and the hours of it away. */
const periodOf = (leave: StandingLeave) =>
  leave.from_time !== null && leave.to_time !== null
    ? copy.hours(fullDate(leave.from), dayClock(leave.from_time), dayClock(leave.to_time))
    : copy.period(fullDate(leave.from), fullDate(leave.to));

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
    <div className={shared.stranded}>
      <p className={shared.strandedTitle}>{copy.stranded.title(jobs.length)}</p>
      <ul className={shared.leaveList}>
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
    const answer = await techniciansApi.cancelLeave(technician.id, leave.id);
    if (!answer.ok) {
      setStep("checking");
      setFailed(refusal(answer.code));
      return;
    }
    await onTakenBack();
  };

  return (
    <li className={styles.period}>
      <div className={shared.leaveRow}>
        <span className={styles.leavePeriod}>{period}</span>
        {leave.note !== null && <span className={styles.leaveNote}>{leave.note}</span>}
        {mayTakeBack && step === "listed" && (
          <Button
            variant="outline"
            size="small"
            className={shared.quiet}
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
          question={copy.check.title(period)}
          lines={[copy.check.line]}
          busy={step === "sending"}
          onSend={() => void takeBack()}
          onBack={() => {
            setStep("listed");
            setFailed(null);
          }}
        />
      )}
      {leave.jobs.length > 0 && <Stranded jobs={leave.jobs} technician={technician} />}
      {failed !== null && <Refusal className={shared.error} said={failed} />}
    </li>
  );
}

interface Entry {
  readonly from: string;
  readonly to: string;
  readonly note: string;
  /** Away between two times of one day, rather than for whole days. */
  readonly partDay: boolean;
  readonly fromTime: string;
  readonly toTime: string;
}

/** When the leave is: its days, or one day and the times of it away. */
function LeaveWhen({ entry, onChange }: { entry: Entry; onChange: (entry: Entry) => void }) {
  const setEntry = onChange;
  return (
    <>
      <div className={styles.fields}>
        <Field className={styles.field} label={copy.from}>
          {(control) => (
            <DateInput
              {...control}
              required
              // The form opens where the button that asked for it stood, so the keyboard goes to its first field.
              autoFocus
              value={entry.from}
              onChange={(event) => {
                setEntry({ ...entry, from: event.target.value });
              }}
            />
          )}
        </Field>
        {!entry.partDay && (
          <Field className={styles.field} label={copy.to}>
            {(control) => (
              <DateInput
                {...control}
                required
                value={entry.to}
                onChange={(event) => {
                  setEntry({ ...entry, to: event.target.value });
                }}
              />
            )}
          </Field>
        )}
        {entry.partDay && (
          <>
            <TimeField
              label={copy.fromTime}
              value={entry.fromTime}
              onChange={(time) => {
                setEntry({ ...entry, fromTime: time });
              }}
            />
            <TimeField
              label={copy.toTime}
              value={entry.toTime}
              onChange={(time) => {
                setEntry({ ...entry, toTime: time });
              }}
            />
          </>
        )}
      </div>
      <Checkbox
        label={copy.partDay}
        checked={entry.partDay}
        onChange={(event) => {
          setEntry({ ...entry, partDay: event.target.checked });
        }}
      />
    </>
  );
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
  const [entry, setEntry] = useState<Entry>({
    from: "",
    to: "",
    note: "",
    partDay: false,
    fromTime: "14:00",
    toTime: "17:00",
  });
  const [sending, once] = useOneAtATime();
  const [failed, setFailed] = useState<string | null>(null);

  const send = () =>
    once(async () => {
      setFailed(null);
      const note = entry.note.trim();
      const answer = await techniciansApi.recordLeave(technician.id, {
        from: entry.from,
        to: entry.partDay ? entry.from : entry.to,
        note: note === "" ? null : note,
        times: entry.partDay ? { from: entry.fromTime, to: entry.toTime } : null,
      });
      if (!answer.ok) {
        setFailed(refusal(answer.code));
        return;
      }
      await onRecorded();
    });

  return (
    <form
      className={shared.leaveForm}
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <LeaveWhen entry={entry} onChange={setEntry} />
      <Field className={styles.field} label={copy.note}>
        {(control) => (
          <TextInput
            {...control}
            maxLength={200}
            value={entry.note}
            onChange={(event) => {
              setEntry({ ...entry, note: event.target.value });
            }}
          />
        )}
      </Field>
      <div className={shared.actions}>
        <Button variant="primary" size="small" className={shared.save} type="submit" disabled={sending}>
          {sending ? copy.saving : copy.save}
        </Button>
        <Button variant="outline" size="small" className={shared.quiet} disabled={sending} onClick={onCancel}>
          {copy.cancel}
        </Button>
      </div>
      {failed !== null && <Refusal className={shared.error} said={failed} />}
    </form>
  );
}

/** Read when the tab opens and again after every change, since the dispatch board reads the same rows. */
export function Leave({ technician }: { technician: TechnicianSummary }) {
  const load = useCallback(() => techniciansApi.standingLeave(technician.id), [technician.id]);
  const [loaded, retry] = useLoad(load);
  const [fresh, setFresh] = useState<readonly StandingLeave[] | null>(null);
  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const mayRecord = useAccess().mayCall("POST /api/technicians/{id}/leave");

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={failedRequestId(loaded)} />;

  const leave = fresh ?? loaded.value.leave;
  const readAgain = async () => {
    const answer = await techniciansApi.standingLeave(technician.id);
    if (answer.ok) setFresh(answer.body.leave);
  };

  return (
    <>
      {leave.length === 0 ? (
        <EmptyState look="panel" line={copy.none} />
      ) : (
        <ul className={shared.leaveList}>
          {leave.map((period) => (
            <Period key={period.id} leave={period} technician={technician} onTakenBack={readAgain} />
          ))}
        </ul>
      )}
      {recorded && (
        <p className={shared.notice} role="status">
          {copy.recorded}
        </p>
      )}
      {!recording && mayRecord && (
        <div className={shared.actions}>
          <Button
            variant="outline"
            size="small"
            className={shared.quiet}
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
