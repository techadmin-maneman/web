// Me (docs/prompts/tech-redesign.md, "Me"), in the new look: the technician's own pages, what waits to send, the way to
// ops, and signing out, which lives here alone, each a one-line row with what it holds at its end, as the prototype
// draws the Account list. Signing out wipes the phone, so it always asks first, and says how many uploads it would
// lose. With no signal the session stays open and nothing is wiped, and it says so (apps/tech/src/App.tsx). Who they
// are, their quality and this month's incentives head it (./Standing.tsx). Guides, language and alerts come with their
// screens.

import { ListRow, ListRows } from "@maneman/ui/ListRow";
import { ConfirmSheet } from "@maneman/ui/ConfirmSheet";
import { Sheet, SheetClose, SheetPanel } from "@maneman/ui/Sheet";
import { useLoad } from "@maneman/ui/useLoad";
import { SectionHead } from "@maneman/ui/SectionHead";
import { formatMobileField } from "@maneman/web-kit/mobile";
import { useEffect, useId, useState } from "react";
import { api } from "../api.ts";
import { AlertsRow } from "../alerts/index.ts";
import { LanguageRow } from "../lang/index.ts";
import { guides, leaving as leavingCopy, me as copy } from "../content.ts";
import { RowEnd } from "../frame/RowEnd.tsx";
import { ReachOps } from "../frame/ReachOps.tsx";
import { SyncLabel, useUnsent } from "../frame/SyncLabel.tsx";
import { useScreen } from "../lib/useScreen.ts";
import { useSession } from "../session.ts";
import { Incentives, Quality } from "./Standing.tsx";
import styles from "./me.module.css";

/** Pending uploads' count: in the error's colour where the API stopped some, else quiet. */
const pendingTone = (stopped: number): "error" | "muted" => (stopped > 0 ? "error" : "muted");

/** Where a sign-out has got to: asking, waiting on the API, or refused for want of signal. */
type Leaving = "asking" | "going" | "stayed" | null;

/**
 * The question before signing out, as the prototype asks it: that everything is uploaded, or how many uploads would be
 * lost; Cancel keeps them, and they send themselves once there is signal.
 */
function SignOutSheet(props: { readonly unsent: number; readonly onLeave: () => void; readonly onStay: () => void }) {
  return (
    <ConfirmSheet
      onPaper
      quietYes
      title={copy.sheet.title}
      body={props.unsent === 0 ? copy.sheet.uploaded : copy.sheet.lost(props.unsent)}
      yes={copy.signOut}
      no={copy.sheet.cancel}
      onYes={props.onLeave}
      onNo={props.onStay}
    />
  );
}

/** Ops in the technician's city, as the prototype's Contact sheet: Call, filled, beside WhatsApp. */
function ContactSheet({ city, onClose }: { readonly city: string | null; readonly onClose: () => void }) {
  const titleId = useId();
  return (
    <Sheet labelledBy={titleId} rises={false} onClose={onClose}>
      <SheetClose onClose={onClose}>{copy.closeContact}</SheetClose>
      <SheetPanel className={styles.contact}>
        <h2 className={styles.contactTitle} id={titleId}>
          {city === null ? copy.contact : copy.contactTitle(city)}
        </h2>
        <ReachOps onPaper named />
      </SheetPanel>
    </Sheet>
  );
}

/** Leave's line: how many asks ops have still to answer, once read; nothing while none are. */
function useWithOps(): number {
  const [loaded] = useLoad(api.leave);
  return loaded.state === "loaded" ? loaded.value.requests.filter((ask) => ask.state === "asked").length : 0;
}

/** The Account list: each of the technician's pages, what waits to send, the way to ops, and signing out. */
function Account(props: { readonly onContact: () => void; readonly onSignOut: () => void }) {
  const { unsent, stopped } = useUnsent();
  const withOps = useWithOps();
  return (
    <ListRows className={styles.rows} label={copy.account}>
      <ListRow title={guides.title} end={<RowEnd value={guides.kinds} />} to="/guides" />
      <ListRow title={copy.leave} end={<RowEnd value={withOps > 0 ? copy.withOps(withOps) : null} />} to="/leave" />
      <LanguageRow />
      <AlertsRow />
      <ListRow
        title={copy.pending}
        to="/waiting"
        end={<RowEnd value={unsent > 0 ? String(unsent) : copy.nothingPending} />}
        endTone={pendingTone(stopped)}
      />
      <ListRow title={copy.contact} end={<RowEnd value={null} />} onClick={props.onContact} />
      <ListRow
        title={<span className={styles.signOut}>{copy.signOut}</span>}
        label={copy.signOut}
        end={<RowEnd value={null} />}
        onClick={props.onSignOut}
      />
    </ListRows>
  );
}

export function MeScreen() {
  const { me, offline, signOut } = useSession();
  const { unsent } = useUnsent();
  const [leaving, setLeaving] = useState<Leaving>(null);
  const [contact, setContact] = useState(false);
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
      <p className={styles.who}>
        {copy.who(me.grade, me.city, me.mobile === null ? null : `+91 ${formatMobileField(me.mobile)}`)}
      </p>
      <Quality />
      <Incentives />

      <SectionHead title={copy.account} size="list" className={styles.section} />
      <Account
        onContact={() => {
          setContact(true);
        }}
        onSignOut={() => {
          // Not twice: the first is still signing out.
          if (leaving !== "going") setLeaving("asking");
        }}
      />
      {leaving === "stayed" && (
        <p className={styles.stayed} role="status">
          {leavingCopy.stayed}
        </p>
      )}

      {contact && (
        <ContactSheet
          city={me.city}
          onClose={() => {
            setContact(false);
          }}
        />
      )}
      {leaving === "asking" && (
        <SignOutSheet
          unsent={unsent}
          onStay={() => {
            setLeaving(null);
          }}
          onLeave={() => void leave()}
        />
      )}
    </main>
  );
}
