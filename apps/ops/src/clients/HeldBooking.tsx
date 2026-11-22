// A booking ops made that waits on its payment link (src/domain/booking/held-bookings.ts): its link copied or texted
// again, as the board's payment links are (../tasks/PaymentLinkActions.tsx), and, where it stands in the way of
// booking another of its kind, let go so that one can be booked.

import { Button } from "@maneman/ui/Button";
import { CancelButton } from "@maneman/ui/CancelButton";
import { FormActions } from "@maneman/ui/FormActions";
import { classes } from "@maneman/ui/classes";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { TextButton } from "@maneman/ui/TextLink";
import { Refusal } from "@maneman/ui/Refusal";
import { useLoad } from "@maneman/ui/useLoad";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { errorText } from "@maneman/web-kit/refusal";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { VisitType } from "../api.ts";
import type { components } from "../api-schema.ts";
import { dispatch, tasks } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { clients } from "../content/clients.ts";
import { clientsApi } from "./clients-api.ts";
import styles from "./book-visit.module.css";

type HeldBooking = components["schemas"]["OpsHeldBookings"]["held"][number];

const linkCopy = tasks.link;
const copy = clients.visits.book.inTheWay;

/** "Sun 22 Nov, 10 am", or the day alone for one held before holds kept their start. */
const whenOf = (date: string, startsAt: string | null) =>
  startsAt === null ? shortDate(date) : `${shortDate(date)}, ${indiaClock(startsAt)}`;

/** When a hold ends, written as its visit is: "7 am that day" on the visit's own day, else "Sat 21 Nov, 7 pm". */
const untilOf = (instant: string, visitDate: string) =>
  indiaDate(instant) === visitDate ? copy.thatDay(indiaClock(instant)) : whenOf(indiaDate(instant), instant);

const named = (type: VisitType) => dispatch.typeNames[type].toLowerCase();

/**
 * Copy a held booking's link, or have Razorpay text it again. `subject` names the booking to a screen reader where
 * several are listed; `shown` says the link is written out above already; `lead` goes first in the row, as letting
 * the booking go. What a press came to is said on its own line beneath the buttons, never in a toast, which would
 * cover them at a phone's width; counted, so a second press says it again.
 */
export function HeldLinkActions({
  holdId,
  url,
  subject = "",
  shown = false,
  lead = null,
}: {
  holdId: string;
  url: string;
  subject?: string;
  shown?: boolean;
  lead?: ReactNode;
}) {
  const [said, setSaid] = useState<{ readonly text: string; readonly count: number } | null>(null);
  const [failed, setFailed] = useState<{ readonly text: string; readonly count: number } | null>(null);
  const [busy, once] = useOneAtATime();
  const line = useRef<HTMLSpanElement>(null);
  const refused = useRef<HTMLSpanElement>(null);
  const maySend = useAccess().mayCall("POST /api/holds/{id}/send-link");
  useEffect(() => {
    if (said !== null) line.current?.scrollIntoView({ block: "nearest" });
  }, [said]);
  useEffect(() => {
    if (failed !== null) refused.current?.scrollIntoView({ block: "nearest" });
  }, [failed]);
  const say = (text: string) => {
    setFailed(null);
    setSaid((last) => ({ text, count: (last?.count ?? 0) + 1 }));
  };
  const refuse = (text: string) => {
    setSaid(null);
    setFailed((last) => ({ text, count: (last?.count ?? 0) + 1 }));
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      say(linkCopy.copied);
    } catch {
      // The browser would not copy it: said so, with the link to copy by hand where it is not written out above.
      refuse(shown ? copy.notCopied : copy.notCopiedHere(url));
    }
  };
  const send = () =>
    once(async () => {
      setSaid(null);
      setFailed(null);
      const answer = await clientsApi.sendHeldLink(holdId);
      if (answer.ok) say(linkCopy.outcomes[answer.body.outcome]);
      else refuse(errorText({ ...copy.errors, ...linkCopy.errors }, { code: answer.code }));
    });
  const about = subject === "" ? null : <VisuallyHidden>{` · ${subject}`}</VisuallyHidden>;
  return (
    <div>
      <span className={styles.heldActions}>
        {lead}
        <TextButton tone="muted" onClick={() => void copyLink()}>
          {linkCopy.copy}
          {about}
        </TextButton>
        {maySend && (
          <TextButton tone="muted" busy={busy} onClick={() => void send()}>
            {busy ? linkCopy.sending : linkCopy.resend}
            {about}
          </TextButton>
        )}
      </span>
      <span role="status" ref={line} className={styles.said}>
        {said !== null && (
          <InlineMessage key={said.count} tone="note" inline className={styles.link}>
            {said.text}
          </InlineMessage>
        )}
      </span>
      {failed !== null && (
        <span key={failed.count} ref={refused} className={classes(styles.said, styles.link)}>
          <Refusal inline said={failed.text} />
        </span>
      )}
    </div>
  );
}

/**
 * One booking held on its link: paid, it is being booked; unpaid, its link, and letting it go, asked once more since
 * its link stops working.
 */
function HeldRow({ held, onLetGo }: { held: HeldBooking; onLetGo: () => void }) {
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, once] = useOneAtATime();
  const mayLetGo = useAccess().mayCall("POST /api/holds/{id}/let-go");
  const keep = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const asked = useRef(false);
  // The ask opens on its safe answer, Keep; kept, or refused, the focus goes back to Let it go.
  useEffect(() => {
    if (asking) keep.current?.focus();
    else if (asked.current) opener.current?.focus();
    asked.current = asking;
  }, [asking]);
  const when = whenOf(held.date, held.starts_at);
  if (held.paid) return <p>{copy.paid(named(held.type), when)}</p>;
  const subject = `${named(held.type)}, ${when}`;
  const letGo = () =>
    once(async () => {
      setFailed(null);
      const answer = await clientsApi.letHeldBookingGo(held.hold_id);
      if (answer.ok) {
        onLetGo();
        return;
      }
      setAsking(false);
      setFailed(errorText(copy.errors, { code: answer.code }));
    });
  const letGoButton = mayLetGo ? (
    <TextButton
      ref={opener}
      tone="muted"
      onClick={() => {
        setAsking(true);
      }}
    >
      {copy.letGo}
      <VisuallyHidden>{` · ${subject}`}</VisuallyHidden>
    </TextButton>
  ) : null;
  // A link still being made has nothing to copy or send yet.
  const actions =
    held.url === null ? (
      <span className={styles.heldActions}>{letGoButton}</span>
    ) : (
      <HeldLinkActions holdId={held.hold_id} url={held.url} subject={subject} lead={letGoButton} />
    );
  return (
    <div className={styles.inTheWay}>
      <p>{copy.held(named(held.type), when, untilOf(held.open_until, held.date))}</p>
      {asking ? (
        <div role="group" aria-label={copy.letGoAsk}>
          <p>{copy.letGoAsk}</p>
          <FormActions>
            <Button variant="destructive" size="small" disabled={busy} onClick={() => void letGo()}>
              {busy ? copy.lettingGo : copy.letGo}
            </Button>
            <CancelButton
              ref={keep}
              keep
              disabled={busy}
              onClick={() => {
                setAsking(false);
              }}
            />
          </FormActions>
        </div>
      ) : (
        actions
      )}
      {failed !== null && <Refusal inline said={failed} />}
    </div>
  );
}

/**
 * What an "Already booked" refusal is about, read as the refusal reads it: the visit still to come, named by its own
 * kind, or the booking held on its link, which ops may let go so another can be booked while it is unpaid.
 */
export function InTheWay({
  clientId,
  kind,
  oneVisit,
  onLetGo,
}: {
  clientId: string;
  kind: VisitType;
  oneVisit: boolean;
  onLetGo: () => void;
}) {
  const load = useCallback(() => clientsApi.heldBookings(clientId, kind, oneVisit), [clientId, kind, oneVisit]);
  const [loaded] = useLoad(load);
  if (loaded.state !== "loaded") return null;
  const { visit, held } = loaded.value;
  return (
    <div className={styles.inTheWay}>
      {visit !== null && <p>{copy.visit(named(visit.kind), whenOf(visit.date, visit.starts_at))}</p>}
      {held.map((each) => (
        <HeldRow key={each.hold_id} held={each} onLetGo={onLetGo} />
      ))}
    </div>
  );
}
