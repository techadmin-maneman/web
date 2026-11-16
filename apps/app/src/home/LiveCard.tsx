// The visit day on Home's card (design/client-redesign, the live card): from the morning of the visit to its end, where
// it stands, as the technician's app moves it on: a move ops asked for; their word on the way, running late or at the
// gate; at the door and how long they wait; the step under way; the client's sign-off of a fit; done, being closed, or
// missed. Home is read again every 30 seconds while it is live, and its title is announced as it changes.

import { CLIENT_ICONS, GLYPHS } from "@maneman/brand/icons";
import { buttonLook } from "@maneman/ui/Button";
import { StepProgress, stepStates } from "@maneman/ui/Progress";
import { apiNow } from "@maneman/web-kit/clock";
import { indiaClock, shortDate, todayInIndia } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { firstNameOf } from "@rules/lib/names.ts";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { VisitSummary } from "../api.ts";
import { live, note, visits } from "../content.ts";
import { AppLink } from "../frame/Shell.tsx";
import { oneVisitOf, summaryName } from "../lib/visit.ts";
import { useSession } from "../session.ts";
import { liveStateOf, MOVING, SETTLED, TRACK_AT, type LiveState } from "./live-state.ts";
import { ProposedMove } from "./ProposedMove.tsx";
import { SignOffPanel, signedLine } from "./SignOffPanel.tsx";
import { Actions, changingOf, Fact, notingOf, OneVisitTerms, Technician, whenText } from "./VisitCard.tsx";
import home from "./home.module.css";
import styles from "./live-card.module.css";

const MINUTE_MS = 60_000;

/**
 * When the technician should now arrive: their minutes away from their word; running late, their minutes past the
 * arrival window, or past their word where it came after the window.
 */
function arrivingAround(visit: VisitSummary): string | null {
  const update = visit.latest_update;
  const minutes = update?.minutes ?? null;
  if (update === null || minutes === null) return null;
  const said = Date.parse(update.at);
  const from = update.kind === "running_late" ? Math.max(Date.parse(visit.arrives_by), said) : said;
  return indiaClock(new Date(from + minutes * MINUTE_MS).toISOString());
}

/** The card's title, and the line beneath it. */
function headOf(visit: VisitSummary, state: LiveState, technician: string): { title: string; line: string | null } {
  const around = arrivingAround(visit);
  const arriving = around === null ? null : live.arrivingAround(around);
  switch (state) {
    case "today":
      return { title: live.visitToday(summaryName(visit)), line: whenText(visit) };
    case "proposal":
      return { title: live.moveAsked, line: whenText(visit) };
    case "on_the_way":
      return { title: live.onTheWay(technician), line: arriving };
    case "running_late":
      return { title: live.runningLate(technician), line: arriving };
    case "at_the_gate":
      return { title: live.atTheGate(technician), line: null };
    case "arrived":
      return { title: live.atTheDoor(technician), line: null };
    case "in_progress": {
      const step = visit.step;
      return {
        title: live.inProgress,
        line: step === null ? null : live.step(step.index, step.of, live.steps[step.name]),
      };
    }
    case "sign_off":
      return { title: live.signOff.title, line: null };
    case "done":
      return { title: live.done, line: signedLine(visit) ?? live.doneLine };
    case "closing":
      return { title: live.closing, line: null };
    case "not_home":
      return { title: live.notHome, line: null };
    case "missed":
      return { title: live.missed, line: null };
  }
}

/** Home read again while the visit is live, so the card follows it. */
function useReadAgain(live: boolean): void {
  const { refresh } = useSession();
  const readAgain = useRef(refresh);
  readAgain.current = refresh;
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => {
      readAgain.current();
    }, 30_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [live]);
}

function Track({ at }: { at: number }) {
  return (
    <div className={styles.track} aria-hidden="true">
      <StepProgress steps={stepStates(live.track.length, at)} />
      <div className={styles.trackNames}>
        {live.track.map((name, index) => (
          <span key={name} className={index === at ? styles.trackNow : undefined}>
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Before the technician arrives: what is paid at the visit, a one visit's terms, and the client's note. */
function Kept({ visit, clientNote }: { visit: VisitSummary; clientNote: string | null }) {
  const oneVisit = oneVisitOf(visit);
  return (
    <>
      {visit.pay_at_visit !== null && (
        <ul className={home.facts}>
          <Fact icon={CLIENT_ICONS.receipt}>{visits.payAtVisit(rupees(visit.pay_at_visit))}</Fact>
        </ul>
      )}
      {oneVisit !== null && <OneVisitTerms price={oneVisit} />}
      {clientNote !== null && <p className={home.place}>{note.shown(clientNote)}</p>}
    </>
  );
}

function Body({ visit, state, technician }: { visit: VisitSummary; state: LiveState; technician: string }): ReactNode {
  switch (state) {
    case "today":
      return <p className={styles.line}>{live.setsOff(technician)}</p>;
    case "proposal":
      return visit.proposed_move === null ? null : <ProposedMove visitId={visit.id} proposal={visit.proposed_move} />;
    case "on_the_way":
    case "running_late":
    case "at_the_gate":
      return <ul className={home.facts}>{visit.place !== "" && <Fact icon={GLYPHS.pin}>{visit.place}</Fact>}</ul>;
    case "arrived":
      return visit.waits_until === null ? null : (
        <p className={styles.line}>{live.waits(indiaClock(visit.waits_until))}</p>
      );
    case "in_progress":
      return <p className={styles.quiet}>{live.updates(technician)}</p>;
    case "sign_off":
      return <SignOffPanel key={visit.sign_off?.asks ?? 0} visit={visit} technician={technician} />;
    case "done":
      return (
        <AppLink
          className={buttonLook({ variant: "gold", size: "action", className: styles.see })}
          to={`/visits/${visit.id}`}
        >
          {live.seePhotos}
        </AppLink>
      );
    case "not_home":
      return <p className={styles.line}>{live.notHomeLine}</p>;
    case "closing":
    case "missed":
      return null;
  }
}

/** Before the technician comes: what is kept on the visit can still be changed. */
const BEFORE: ReadonlySet<LiveState> = new Set(["today", "proposal", "on_the_way", "running_late", "at_the_gate"]);
/** Who is coming, while that still helps. */
const NAMED: ReadonlySet<LiveState> = new Set(["today", "on_the_way", "running_late", "at_the_gate", "arrived"]);

export function LiveCard({ visit, label }: { visit: VisitSummary; label: { readonly id: string } }) {
  const state = liveStateOf(visit);
  const today = todayInIndia(apiNow());
  useReadAgain(!SETTLED.has(state) && visit.date === today);
  // A note just saved, shown before the visit is read again.
  const [noted, setNoted] = useState<string | null>(null);
  const clientNote = noted ?? visit.client_note;
  const technician = visit.technician === null ? live.yourTechnician : firstNameOf(visit.technician.name);
  const { title, line } = headOf(visit, state, technician);
  const what = summaryName(visit);
  const track = TRACK_AT[state];
  return (
    <div className={home.card}>
      <h2 className={home.eyebrow} id={label.id}>
        {MOVING.has(state) && <span className={styles.pulse} aria-hidden="true" />}
        {visit.date === today ? live.today : shortDate(visit.date)}
      </h2>
      <div aria-live="polite">
        <p className={home.date}>{title}</p>
        {line !== null && <p className={home.away}>{line}</p>}
      </div>
      {track !== null && <Track at={track} />}
      <Body visit={visit} state={state} technician={technician} />
      {BEFORE.has(state) && <Kept visit={visit} clientNote={clientNote} />}
      {NAMED.has(state) && visit.technician !== null && <Technician technician={visit.technician} />}
      {(state === "today" || state === "proposal") && (
        <Actions
          what={what}
          date={shortDate(visit.date)}
          changing={changingOf(visit, what)}
          noting={{ ...notingOf(visit), note: clientNote }}
          onNoted={setNoted}
          proposed={state === "proposal"}
        />
      )}
    </div>
  );
}

/** Whether Home's card is the visit day's: on its day in India, or once the visit has begun. */
export const isLive = (visit: VisitSummary, today: string): boolean =>
  visit.date === today || (visit.stage !== null && visit.stage !== "booked");
