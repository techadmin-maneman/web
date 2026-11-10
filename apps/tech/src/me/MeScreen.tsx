// Me (docs/prompts/tech-redesign.md, "Me"), in the new look: the technician's own pages, what waits to send, the way to
// ops, and signing out, which lives here alone. Signing out wipes the phone, so it always asks first: with work on it
// that has not reached us, it offers to send it. With no signal the session stays open and nothing is wiped, and it
// says so (apps/tech/src/App.tsx). Quality, incentives, guides, language and alerts come with their screens.

import { ListRow, ListRows } from "@maneman/ui/ListRow";
import { ConfirmSheet } from "@maneman/ui/ConfirmSheet";
import { SectionHead } from "@maneman/ui/SectionHead";
import { useEffect, useState } from "react";
import { leaving as leavingCopy, me as copy } from "../content.ts";
import { ReachOps } from "../frame/ReachOps.tsx";
import { SyncLabel, useUnsent } from "../frame/SyncLabel.tsx";
import { photoSets } from "../lib/sets.ts";
import { useOutbox } from "../lib/useOutbox.ts";
import { useScreen } from "../lib/useScreen.ts";
import { useSession } from "../session.ts";
import { replay } from "../store/outbox.ts";
import styles from "./me.module.css";

/** Pending uploads' count: in the error's colour where the API stopped some, else marked while any wait. */
function pendingTone(unsent: number, stopped: number): "error" | "attention" | "muted" {
  if (stopped > 0) return "error";
  return unsent > 0 ? "attention" : "muted";
}

/** Where a sign-out has got to: asking, waiting on the API, or refused for want of signal. */
type Leaving = "asking" | "going" | "stayed" | null;

/** The question before signing out: with unsent work, sending it first is the safe answer. */
function SignOutSheet(props: {
  readonly onLeave: () => void;
  readonly onSend: () => void;
  readonly onStay: () => void;
}) {
  const waiting = useOutbox();
  const sets = photoSets(waiting.frames, waiting.events).length;
  const actions = waiting.events.length;
  if (sets + actions === 0) {
    return (
      <ConfirmSheet
        onPaper
        title={copy.sheet.title}
        body={copy.sheet.uploaded}
        yes={copy.signOut}
        no={copy.sheet.cancel}
        onYes={props.onLeave}
        onNo={props.onStay}
      />
    );
  }
  return (
    <ConfirmSheet
      onPaper
      title={copy.sheet.title}
      body={`${leavingCopy.unsent(sets, actions)}. ${leavingCopy.body}`}
      yes={leavingCopy.anyway}
      no={leavingCopy.send}
      onYes={props.onLeave}
      onNo={props.onSend}
    />
  );
}

export function MeScreen() {
  const { me, offline, signOut } = useSession();
  const { unsent, stopped } = useUnsent();
  const [leaving, setLeaving] = useState<Leaving>(null);
  const heading = useScreen(copy.title);

  // Signal back: the sign-out that waited for it can be tried again, so the line saying it could not goes.
  useEffect(() => {
    if (!offline) setLeaving((was) => (was === "stayed" ? null : was));
  }, [offline]);

  async function leave(): Promise<void> {
    setLeaving("going");
    if ((await signOut()) === "still-signed-in") setLeaving("stayed");
  }

  return (
    <main className={styles.screen} data-look="light">
      <header className={styles.head}>
        <h1 className={styles.title} ref={heading} tabIndex={-1}>
          {copy.title}
        </h1>
        <SyncLabel />
      </header>
      <p className={styles.name}>{me.name}</p>

      <ListRows className={styles.rows} label={copy.title}>
        <ListRow title={copy.month} to="/month" />
        <ListRow title={copy.leave} to="/leave" />
        <ListRow
          title={copy.pending}
          to="/waiting"
          end={unsent > 0 ? String(unsent) : copy.nothingPending}
          endTone={pendingTone(unsent, stopped)}
        />
        <ListRow
          title={copy.signOut}
          onClick={() => {
            // Not twice: the first is still signing out.
            if (leaving !== "going") setLeaving("asking");
          }}
        />
      </ListRows>
      {leaving === "stayed" && (
        <p className={styles.stayed} role="status">
          {leavingCopy.stayed}
        </p>
      )}

      <SectionHead title={copy.contact} className={styles.section} />
      <ReachOps className={styles.ops} onPaper />

      {leaving === "asking" && (
        <SignOutSheet
          onStay={() => {
            setLeaving(null);
          }}
          onSend={() => {
            setLeaving(null);
            void replay();
          }}
          onLeave={() => void leave()}
        />
      )}
    </main>
  );
}
