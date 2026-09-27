// Technicians (Ops Console, board D3): who works, their zone, the jobs they
// have finished and how those ran, one 34 px row each, as the board draws them,
// however many there are. The board's fifth column is Skill, and nothing records
// what a technician is trained for, so Leave stands there instead and a line
// beneath the table says why (docs/open-points.md, item 59).
//
// A technician's name opens a panel over the roster with the phones they have
// logged in on and their leave, which the board's rows have no room for.
// Revoking a phone ends its session and makes it drop its cached jobs, so it
// asks before it sends (src/domain/technicians.ts). Leave is recorded here
// because FSM has nowhere to keep it (ADR 0062). It is not a note: the days it
// covers are refused to self-serve booking and to the dispatch board alike,
// which is why the form says so before it is sent.

import { Button, buttonLook } from "@maneman/ui/Button";
import { Dialog } from "@maneman/ui/Dialog";
import { useLoad } from "@maneman/ui/useLoad";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { fullDate, indiaClock, indiaDate, listDate, longDate, shortDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { api, type Device, type JobOnLeave, type Leave, type Technician, type TechnicianWork } from "../api.ts";
import { OpsLink, Shell } from "../components/Shell.tsx";
import { technicians } from "../content.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "./technicians.module.css";

/** The route's period ends the day after the last one counted; the note names that last day. */
const lastDay = (exclusiveEnd: string) =>
  new Date(Date.parse(`${exclusiveEnd}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/**
 * How long the technician's visits took, on average. A technician the phone
 * timed none of reads as a gap, never as a nought: the jobs were done and
 * nothing timed them. One who runs over the length their visits were planned
 * for reads in oxblood, as the board letters its own long average.
 */
function Service({ figures }: { figures: TechnicianWork | undefined }) {
  const copy = technicians.work;
  const average = figures?.average_minutes ?? null;
  const planned = figures?.average_planned_minutes ?? null;
  if (figures === undefined || average === null || planned === null) {
    return <span className={styles.none}>{technicians.unknown}</span>;
  }

  return (
    <>
      <span className={average - planned >= copy.overBy ? styles.over : undefined}>
        {copy.average(Math.floor(average / 60), average % 60)}
      </span>
      {/* The average is of the jobs the phone timed, so it says so when that is not all of them. */}
      {figures.timed_jobs < figures.jobs && (
        <span className={styles.base}>{copy.base(figures.timed_jobs, figures.jobs)}</span>
      )}
    </>
  );
}

/** The Leave column: away today, the first day of leave still to come, or a gap. */
function LeaveCell({ leave, today }: { leave: readonly Leave[]; today: string }) {
  const next = leave[0];
  if (next === undefined) return <span className={styles.none}>{technicians.unknown}</span>;
  if (next.from <= today) return <span className={styles.away}>{technicians.away}</span>;
  return <span>{technicians.from(listDate(next.from, Number(today.slice(0, 4))))}</span>;
}

/** "Chrome on Android · 3f9a": what the browser said, and the end of the phone's own ID. */
const phoneName = (phone: Device) =>
  technicians.phones.label(phone.label ?? technicians.phones.unlabelled, phone.device_id.slice(-4));

/** Where a phone is: listed, asked about, sending, revoked here, or refused by the API. */
type Revoking =
  | { readonly step: "listed" }
  | { readonly step: "asking" }
  | { readonly step: "sending" }
  | { readonly step: "revoked"; readonly at: string }
  | { readonly step: "failed"; readonly code: string };

function Phone({ phone, technician }: { phone: Device; technician: Technician }) {
  const [revoking, setRevoking] = useState<Revoking>({ step: "listed" });
  const copy = technicians.phones;
  const name = phoneName(phone);

  const revoke = async () => {
    setRevoking({ step: "sending" });
    const answer = await api.revokeDevice(technician.id, phone.device_id);
    if (answer.ok) setRevoking({ step: "revoked", at: answer.body.revoked_at });
    else setRevoking({ step: "failed", code: answer.code });
  };

  // The route's answer, else what it was when the roster was read.
  const revokedAt = revoking.step === "revoked" ? revoking.at : phone.revoked_at;
  const sending = revoking.step === "sending";
  // A phone is offered, then asked about, then gone: one of the three at a time.
  const gone = revokedAt !== null;
  const asking = !gone && (revoking.step === "asking" || sending);
  const offered = !gone && !asking;

  return (
    <li className={styles.phone}>
      <div className={styles.phoneLine}>
        <span className={styles.phoneName}>{name}</span>
        <span className={styles.seen}>{copy.seen(longDate(phone.last_seen_at))}</span>
      </div>
      {revokedAt !== null && <p className={styles.revoked}>{copy.revoked(longDate(revokedAt))}</p>}
      {asking && (
        <div className={styles.asking}>
          <p className={styles.warning}>{copy.warning}</p>
          <div className={styles.actions}>
            <Button
              variant="danger"
              size="small"
              className={styles.revoke}
              disabled={sending}
              onClick={() => void revoke()}
            >
              {sending ? copy.revoking : copy.confirm}
            </Button>
            <Button
              variant="outline"
              size="small"
              className={styles.quiet}
              disabled={sending}
              onClick={() => {
                setRevoking({ step: "listed" });
              }}
            >
              {copy.cancel}
            </Button>
          </div>
        </div>
      )}
      {offered && (
        <div className={styles.actions}>
          <Button
            variant="outline"
            size="small"
            className={styles.quiet}
            aria-label={copy.revokeLabel(name, technician.name)}
            onClick={() => {
              setRevoking({ step: "asking" });
            }}
          >
            {copy.revoke}
          </Button>
        </div>
      )}
      {revoking.step === "failed" && (
        <p className={styles.error} role="alert">
          {copy.errors[revoking.code] ?? copy.errors.unknown}
        </p>
      )}
    </li>
  );
}

/** How a period reads once recorded: "19 Sep 2026 to 23 Sep 2026", or one date on its own. */
const periodOf = (leave: Leave) => technicians.leave.period(fullDate(leave.from), fullDate(leave.to));

/**
 * The jobs already booked on the leave just recorded, which it moved nowhere (OPS-07): each also waits on the
 * Tasks board, and the dispatch board marks its day.
 */
function Stranded({ jobs }: { jobs: readonly JobOnLeave[] }) {
  const copy = technicians.leave.stranded;
  return (
    <div className={styles.stranded} role="status">
      <p className={styles.strandedTitle}>{copy.title(jobs.length)}</p>
      <ul className={styles.leaveList}>
        {jobs.map((job) => (
          <li className={styles.leaveRow} key={job.appointment_id}>
            {copy.job(
              `${shortDate(indiaDate(job.starts_at))}, ${indiaClock(job.starts_at)}`,
              job.client ?? copy.noClient,
            )}
          </li>
        ))}
      </ul>
      <OpsLink className={buttonLook({ variant: "outline", size: "small", className: styles.quiet })} to="/dispatch">
        {copy.move}
      </OpsLink>
    </div>
  );
}

/**
 * One technician's leave: what is recorded, and the form that records more.
 * Every change reads the roster again, because the dispatch board reads the
 * same rows and the two must not disagree.
 */
function LeaveBlock({ technician, onChange }: { technician: Technician; onChange: () => Promise<void> }) {
  const copy = technicians.leave;
  const [form, setForm] = useState<{ from: string; to: string; note: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [stranded, setStranded] = useState<readonly JobOnLeave[]>([]);
  /** Why it was refused, in the console's words; nothing was recorded either way. */
  const refusal = (code: string): string => {
    const errors: Readonly<Record<string, string | undefined>> = copy.errors;
    return errors[code] ?? copy.errors.unknown;
  };

  const send = async (entry: { from: string; to: string; note: string }) => {
    setSending(true);
    setFailed(null);
    const answer = await api.recordLeave(technician.id, {
      from: entry.from,
      to: entry.to,
      note: entry.note.trim() === "" ? null : entry.note.trim(),
    });
    if (!answer.ok) {
      setSending(false);
      setFailed(refusal(answer.code));
      return;
    }
    await onChange();
    setSending(false);
    setForm(null);
    setStranded(answer.body.jobs);
  };

  const take = async (leave: Leave) => {
    setSending(true);
    setFailed(null);
    const answer = await api.cancelLeave(technician.id, leave.id);
    if (answer.ok) await onChange();
    else setFailed(refusal(answer.code));
    setSending(false);
  };

  return (
    <section className={styles.section} aria-labelledby="leave-title">
      <h3 className={styles.sectionTitle} id="leave-title">
        {copy.title}
      </h3>
      {technician.leave.length === 0 ? (
        <p className={styles.none}>{copy.none}</p>
      ) : (
        <ul className={styles.leaveList}>
          {technician.leave.map((leave) => (
            <li className={styles.leaveRow} key={leave.id}>
              <span className={styles.leavePeriod}>{periodOf(leave)}</span>
              {leave.note !== null && <span className={styles.leaveNote}>{leave.note}</span>}
              <Button
                variant="outline"
                size="small"
                className={styles.quiet}
                disabled={sending}
                aria-label={copy.takeLabel(periodOf(leave), technician.name)}
                onClick={() => void take(leave)}
              >
                {sending ? copy.taking : copy.take}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {form === null ? (
        <div className={styles.actions}>
          <Button
            variant="outline"
            size="small"
            className={styles.quiet}
            aria-label={copy.addLabel(technician.name)}
            onClick={() => {
              setFailed(null);
              setForm({ from: "", to: "", note: "" });
            }}
          >
            {copy.add}
          </Button>
        </div>
      ) : (
        <form
          className={styles.leaveForm}
          onSubmit={(event) => {
            event.preventDefault();
            void send(form);
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
                value={form.from}
                onChange={(event) => {
                  setForm({ ...form, from: event.target.value });
                }}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>{copy.to}</span>
              <input
                className={styles.input}
                type="date"
                required
                value={form.to}
                onChange={(event) => {
                  setForm({ ...form, to: event.target.value });
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
              value={form.note}
              onChange={(event) => {
                setForm({ ...form, note: event.target.value });
              }}
            />
          </label>
          <div className={styles.actions}>
            <Button variant="danger" size="small" className={styles.revoke} type="submit" disabled={sending}>
              {sending ? copy.saving : copy.save}
            </Button>
            <Button
              variant="outline"
              size="small"
              className={styles.quiet}
              disabled={sending}
              onClick={() => {
                setForm(null);
              }}
            >
              {copy.cancel}
            </Button>
          </div>
        </form>
      )}

      {stranded.length > 0 && <Stranded jobs={stranded} />}

      {failed !== null && (
        <p className={styles.error} role="alert">
          {failed}
        </p>
      )}
    </section>
  );
}

/**
 * One technician's phones and leave, in a panel over the roster. It is a modal
 * dialog, so the roster behind it is inert and the keyboard stays inside, and
 * it hands the keyboard back to the name that opened it when it closes.
 */
function TechnicianPanel({
  technician,
  onChange,
  onClose,
}: {
  technician: Technician;
  onChange: () => Promise<void>;
  onClose: () => void;
}) {
  const copy = technicians.phones;
  return (
    <Dialog className={styles.drawer} labelledBy="technician-title" canClose onDismiss={onClose}>
      <div className={styles.drawerHead}>
        <h2 className={styles.drawerTitle} id="technician-title">
          {technician.name}
        </h2>
        <Button variant="outline" size="small" className={styles.quiet} onClick={onClose}>
          {technicians.close}
        </Button>
      </div>
      <div className={styles.drawerBody}>
        <section className={styles.section} aria-labelledby="phones-title">
          <h3 className={styles.sectionTitle} id="phones-title">
            {copy.title}
          </h3>
          {technician.devices.length === 0 ? (
            <p className={styles.none}>{copy.none}</p>
          ) : (
            <ul className={styles.phoneList}>
              {technician.devices.map((phone) => (
                <Phone key={phone.device_id} phone={phone} technician={technician} />
              ))}
            </ul>
          )}
        </section>
        <LeaveBlock technician={technician} onChange={onChange} />
      </div>
    </Dialog>
  );
}

function Roster() {
  const [loaded, retry] = useLoad(api.technicians);
  // The roster carries no period, so the figures are a read of their own; the
  // table is one table either way, and waits for both.
  const [work, retryWork] = useLoad(api.technicianWork);
  // The roster as read again after a change in the panel, which stays open over it meanwhile.
  const [fresh, setFresh] = useState<readonly Technician[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  if (loaded.state === "loading" || work.state === "loading") return <Loading />;
  if (loaded.state === "failed" || work.state === "failed") {
    return (
      <PanelFailed
        onRetry={() => {
          retry();
          retryWork();
        }}
      />
    );
  }

  const roster = fresh ?? loaded.value.technicians;
  const figures = new Map(work.value.technicians.map((each) => [each.technician_id, each]));
  const today = indiaDate(new Date().toISOString());
  const opened = roster.find((technician) => technician.id === open);
  const readAgain = async () => {
    const answer = await api.technicians();
    if (answer.ok) setFresh(answer.body.technicians);
  };

  return (
    <section className={styles.panel} aria-labelledby="roster">
      <VisuallyHidden as="h2" id="roster">
        {technicians.title}
      </VisuallyHidden>
      {roster.length === 0 ? (
        <p className={styles.empty}>{technicians.empty}</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              {technicians.columns.map((column) => (
                <th key={column} scope="col" className={styles.head}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roster.map((technician) => (
              <tr key={technician.id}>
                <th scope="row" className={styles.name}>
                  <button
                    className={styles.choose}
                    type="button"
                    aria-label={technicians.open(technician.name)}
                    onClick={() => {
                      setOpen(technician.id);
                    }}
                  >
                    {technician.name}
                  </button>
                </th>
                <td className={styles.zone}>{technician.zone ?? technicians.unknown}</td>
                <td className={styles.jobs}>{figures.get(technician.id)?.jobs ?? technicians.unknown}</td>
                <td className={styles.service}>
                  <Service figures={figures.get(technician.id)} />
                </td>
                <td className={styles.leaveCell}>
                  <LeaveCell leave={technician.leave} today={today} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className={styles.note}>
        {technicians.work.period(fullDate(work.value.from), fullDate(lastDay(work.value.to)))}
      </p>
      <p className={styles.note}>{technicians.work.skill}</p>
      {opened !== undefined && (
        <TechnicianPanel
          technician={opened}
          onChange={readAgain}
          onClose={() => {
            setOpen(null);
          }}
        />
      )}
    </section>
  );
}

export function TechniciansScreen() {
  return (
    <Shell section="/technicians" title={technicians.title}>
      <div className={styles.column}>
        <Roster />
      </div>
    </Shell>
  );
}
