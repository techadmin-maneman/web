// The visit day on Home's card (design/client-redesign, the live card): from the morning of the visit to its end, where
// it stands, as the technician's app moves it on: their word on the way, running late or at the gate; at the door and
// how long they wait; the step under way; the client's sign-off of a fit; and done. Home is read again every 30
// seconds while it is live.

import { GLYPHS } from "@maneman/brand/icons";
import { buttonLook } from "@maneman/ui/Button";
import { StepProgress, stepStates } from "@maneman/ui/Progress";
import { indiaClock, shortDate } from "@maneman/web-kit/dates";
import { firstNameOf } from "@rules/lib/names.ts";
import { useEffect, useRef, type ReactNode } from "react";
import type { VisitSummary } from "../api.ts";
import { live } from "../content.ts";
import { AppLink } from "../frame/Shell.tsx";
import { summaryName } from "../lib/visit.ts";
import { useSession } from "../session.ts";
import { liveStateOf, TRACK_AT, type LiveState } from "./live-state.ts";
import { SignOffPanel, signedLine } from "./SignOffPanel.tsx";
import { Actions, changingOf, Fact, notingOf, Technician, whenText } from "./VisitCard.tsx";
import home from "./home.module.css";
import styles from "./live-card.module.css";

const MINUTE_MS = 60_000;

/** When the technician should now arrive: their minutes away from their word, or late from the booked start. */
function arrivingAround(visit: VisitSummary): string | null {
  const update = visit.latest_update;
  const minutes = update?.minutes ?? null;
  if (update === null || minutes === null) return null;
  const from = update.kind === "running_late" ? visit.starts_at : update.at;
  return indiaClock(new Date(Date.parse(from) + minutes * MINUTE_MS).toISOString());
}

/** The card's title, and the line beneath it. */
function headOf(visit: VisitSummary, state: LiveState, technician: string): { title: string; line: string | null } {
  const around = arrivingAround(visit);
  switch (state) {
    case "today":
      return { title: live.visitToday(summaryName(visit)), line: whenText(visit) };
    case "on_the_way":
      return { title: live.onTheWay(technician), line: around === null ? null : live.arrivingAround(around) };
    case "running_late":
      return { title: live.runningLate(technician), line: around === null ? null : live.arrivingAround(around) };
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

function Body({ visit, state, technician }: { visit: VisitSummary; state: LiveState; technician: string }): ReactNode {
  switch (state) {
    case "today":
      return <p className={styles.line}>{live.setsOff(technician)}</p>;
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
      return <SignOffPanel visit={visit} technician={technician} />;
    case "done":
      return (
        <AppLink
          className={buttonLook({ variant: "gold", size: "action", className: styles.see })}
          to={`/visits/${visit.id}`}
        >
          {live.seePhotos}
        </AppLink>
      );
  }
}

export function LiveCard({ visit, label }: { visit: VisitSummary; label: { readonly id: string } }) {
  const state = liveStateOf(visit);
  useReadAgain(state !== "done");
  const technician = visit.technician === null ? live.yourTechnician : firstNameOf(visit.technician.name);
  const { title, line } = headOf(visit, state, technician);
  const what = summaryName(visit);
  return (
    <div className={home.card}>
      <h2 className={home.eyebrow} id={label.id}>
        {state !== "today" && state !== "done" && <span className={styles.pulse} aria-hidden="true" />}
        {live.today}
      </h2>
      <p className={home.date}>{title}</p>
      {line !== null && <p className={home.away}>{line}</p>}
      {state !== "sign_off" && <Track at={TRACK_AT[state]} />}
      <Body visit={visit} state={state} technician={technician} />
      {state !== "done" && state !== "sign_off" && visit.technician !== null && (
        <Technician technician={visit.technician} />
      )}
      {state === "today" && (
        <Actions
          what={what}
          date={shortDate(visit.date)}
          changing={changingOf(visit, what)}
          noting={notingOf(visit)}
          proposed={visit.proposed_move !== null}
        />
      )}
    </div>
  );
}

/** Whether Home's card is the visit day's: on its day in India, or once the visit has begun. */
export const isLive = (visit: VisitSummary, today: string): boolean =>
  visit.date === today || (visit.stage !== null && visit.stage !== "booked");
