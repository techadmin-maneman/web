// A booking ops made that waits on its payment link (src/domain/booking/held-bookings.ts): its link copied or texted
// again, as the board's payment links are (../tasks/PaymentLinkActions.tsx), and, where it stands in the way of
// booking another of its kind, let go so that one can be booked.

import { TextButton } from "@maneman/ui/TextLink";
import { Toast } from "@maneman/ui/Toast";
import { Refusal } from "@maneman/ui/Refusal";
import { useLoad } from "@maneman/ui/useLoad";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { errorText } from "@maneman/web-kit/refusal";
import { useCallback, useState } from "react";
import type { VisitType } from "../api.ts";
import { dispatch, tasks } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { clients } from "../content/clients.ts";
import { clientsApi } from "./clients-api.ts";
import styles from "./book-visit.module.css";

const linkCopy = tasks.link;
const copy = clients.visits.book.inTheWay;

/** "Sun 22 Nov, 10 am", or the day alone for one held before holds kept their start. */
const whenOf = (date: string, startsAt: string | null) =>
  startsAt === null ? shortDate(date) : `${shortDate(date)}, ${indiaClock(startsAt)}`;

/** "7 am Sun 22 Nov". */
const untilOf = (instant: string) => `${indiaClock(instant)} ${shortDate(indiaDate(instant))}`;

/** Copy a held booking's link, or have Razorpay text it again. */
export function HeldLinkActions({ holdId, url }: { holdId: string; url: string }) {
  const [done, setDone] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, once] = useOneAtATime();
  const maySend = useAccess().mayCall("POST /api/holds/{id}/send-link");
  const copyLink = async () => {
    setFailed(null);
    try {
      await navigator.clipboard.writeText(url);
      setDone(linkCopy.copied);
    } catch {
      // The browser would not copy it, so the address is shown to copy by hand.
      setDone(url);
    }
  };
  const send = () =>
    once(async () => {
      setDone("");
      setFailed(null);
      const answer = await clientsApi.sendHeldLink(holdId);
      if (answer.ok) setDone(linkCopy.outcomes[answer.body.outcome]);
      else setFailed(errorText({ ...copy.errors, ...linkCopy.errors }, { code: answer.code }));
    });
  return (
    <span className={styles.heldActions}>
      <TextButton tone="muted" compact onClick={() => void copyLink()}>
        {linkCopy.copy}
      </TextButton>
      {maySend && (
        <TextButton tone="muted" compact disabled={busy} onClick={() => void send()}>
          {busy ? linkCopy.sending : linkCopy.resend}
        </TextButton>
      )}
      {done !== "" && <Toast>{done}</Toast>}
      {failed !== null && <Refusal inline said={failed} />}
    </span>
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
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, once] = useOneAtATime();
  const mayLetGo = useAccess().mayCall("POST /api/holds/{id}/let-go");
  if (loaded.state !== "loaded") return null;
  const { visit, held } = loaded.value;
  const named = (type: VisitType) => dispatch.typeNames[type].toLowerCase();
  const letGo = (holdId: string) =>
    once(async () => {
      setFailed(null);
      const answer = await clientsApi.letHeldBookingGo(holdId);
      if (answer.ok) onLetGo();
      else setFailed(errorText(copy.errors, { code: answer.code }));
    });
  return (
    <div className={styles.inTheWay}>
      {visit !== null && <p>{copy.visit(named(visit.kind), whenOf(visit.date, visit.starts_at))}</p>}
      {held.map((each) =>
        each.paid ? (
          <p key={each.hold_id}>{copy.paid(named(each.type), whenOf(each.date, each.starts_at))}</p>
        ) : (
          <div key={each.hold_id}>
            <p>{copy.held(named(each.type), whenOf(each.date, each.starts_at), untilOf(each.open_until))}</p>
            <span className={styles.heldActions}>
              {mayLetGo && (
                <TextButton tone="muted" compact disabled={busy} onClick={() => void letGo(each.hold_id)}>
                  {busy ? copy.lettingGo : copy.letGo}
                </TextButton>
              )}
              {each.url !== null && <HeldLinkActions holdId={each.hold_id} url={each.url} />}
            </span>
          </div>
        ),
      )}
      {failed !== null && <Refusal inline said={failed} />}
    </div>
  );
}
