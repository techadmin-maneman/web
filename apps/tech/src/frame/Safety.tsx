// The Safety sheet, from the shield in a visit's header (docs/prompts/tech-redesign.md, "Safety"; docs/decisions/0248-
// safety.md): that ops can see the technician's location until the visit closes, while it is under way; the SOS held
// for three seconds, which alerts ops and shares where they are; and ops' line and 112. Once sent it says when, and
// "I'm safe" tells ops so; the SOS can be raised again after it, and the sheet starts afresh once ops have handled it.

import { GLYPHS } from "@maneman/brand/icons";
import { Button, ButtonLink } from "@maneman/ui/Button";
import { HoldButton } from "@maneman/ui/HoldButton";
import { IconButton } from "@maneman/ui/IconButton";
import { Sheet, SheetClose, SheetPanel } from "@maneman/ui/Sheet";
import { useAsync, valueOr } from "@maneman/ui/useAsync";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { OPS_NUMBER } from "@maneman/web-kit/whatsapp";
import { useCallback, useId, useRef, useState } from "react";
import { api } from "../api.ts";
import { ops, safety as copy } from "../content.ts";
import { buzz } from "../lib/haptics.ts";
import { checkedIn, closed } from "../lib/progress.ts";
import { signatureOf, useOutbox } from "../lib/useOutbox.ts";
import { clock } from "../lib/when.ts";
import { readPosition } from "../lib/where.ts";
import { keptJob } from "../store/jobs.ts";
import styles from "./safety.module.css";

/** Where an SOS stands on this phone: not sent, sent at a time (and whether they said they are safe), or refused. */
type SosState =
  | { readonly state: "none" }
  | { readonly state: "sent"; readonly at: string; readonly safe: boolean }
  | { readonly state: "failed" };

/**
 * Whether the phone is sharing where it is: the visit checked in and not closed, by what landed or is on its way. Read
 * as the sheet opens, and again as the outbox changes.
 */
function useSharing(jobId: string | null): boolean {
  const waiting = useOutbox();
  const read = useCallback(() => (jobId === null ? Promise.resolve(null) : keptJob(jobId).catch(() => null)), [jobId]);
  const job = valueOr(useAsync(read, signatureOf(waiting))[0], null);
  return job !== null && checkedIn(job, waiting.events) && !closed(job, waiting.events);
}

/** The SOS sent: when, and "I'm safe" until they say it, with a word where that did not reach ops. */
function Sent({
  sent,
  safeFailed,
  onSafe,
}: {
  readonly sent: { readonly at: string; readonly safe: boolean };
  readonly safeFailed: boolean;
  readonly onSafe: () => void;
}) {
  return (
    <>
      <div className={styles.sent} role="status">
        <p className={styles.sentAt}>{copy.sent(sent.at)}</p>
        <p className={styles.note}>{sent.safe ? copy.safeSaid : copy.sentBody}</p>
        {!sent.safe && (
          <Button variant="outline" size="action" onClick={onSafe}>
            {copy.safe}
          </Button>
        )}
      </div>
      {!sent.safe && safeFailed && (
        <p className={styles.failed} role="alert">
          {copy.safeFailed}
        </p>
      )}
    </>
  );
}

function SafetySheet({
  jobId,
  sos,
  sending,
  safeFailed,
  onSos,
  onSafe,
  onClose,
}: {
  readonly jobId: string | null;
  readonly sos: SosState;
  readonly sending: boolean;
  readonly safeFailed: boolean;
  readonly onSos: () => void;
  readonly onSafe: () => void;
  readonly onClose: () => void;
}) {
  const titleId = useId();
  const holdId = useId();
  const sharing = useSharing(jobId);
  const sent = sos.state === "sent" ? sos : null;
  return (
    <Sheet labelledBy={titleId} rises={false} onClose={onClose}>
      <SheetClose onClose={onClose}>{copy.close}</SheetClose>
      <SheetPanel className={styles.panel}>
        <h2 className={styles.title} id={titleId}>
          {copy.title}
        </h2>
        {sharing && <p className={styles.note}>{copy.sharing}</p>}
        {sent !== null && <Sent sent={sent} safeFailed={safeFailed} onSafe={onSafe} />}
        {/* Said safe, and in need again: the SOS is there to raise again. */}
        {(sent === null || sent.safe) && (
          <>
            <HoldButton
              className={styles.sos}
              sub={copy.sosSub}
              holdingSub={copy.keepHolding}
              describedBy={holdId}
              onHeld={onSos}
            >
              {copy.sos}
            </HoldButton>
            <p className={styles.note} id={holdId}>
              {copy.hold}
            </p>
          </>
        )}
        {sending && (
          <p className={styles.sending} role="status">
            {copy.sending}
          </p>
        )}
        {sos.state === "failed" && (
          <p className={styles.failed} role="alert">
            {copy.failed}
          </p>
        )}
        <div className={styles.calls}>
          <ButtonLink variant="outline" size="action" href={`tel:+${OPS_NUMBER}`}>
            {ops.call}
          </ButtonLink>
          <ButtonLink variant="outline" size="action" href="tel:112">
            {copy.call112}
          </ButtonLink>
        </div>
      </SheetPanel>
    </Sheet>
  );
}

/**
 * Where the technician's SOS stands, read from the API as the sheet opens, and the two things done from it: raised,
 * straight to the API and never queued, as it must reach ops now or say it did not, with the visit and a quick reading
 * of where the phone is, a closer one following once the phone has it; and "I'm safe".
 */
function useSos(jobId: string | null) {
  const [sos, setSos] = useState<SosState>({ state: "none" });
  const [safeFailed, setSafeFailed] = useState(false);
  const [sending, once] = useOneAtATime();
  const ownId = useRef<string | null>(null);
  const read = async () => {
    const answer = await api.ownSos();
    if (!answer.ok) return;
    // Handled by ops since: the sheet starts afresh.
    if (answer.body.sos === null) {
      ownId.current = null;
      setSos((was) => (was.state === "sent" ? { state: "none" } : was));
      return;
    }
    ownId.current = answer.body.sos.id;
    setSos({ state: "sent", at: clock(answer.body.sos.sent_at), safe: answer.body.sos.safe });
  };
  const raise = () =>
    once(async () => {
      const answer = await api.sos(jobId, await readPosition("quick"));
      if (!answer.ok) {
        setSos({ state: "failed" });
        return;
      }
      buzz();
      ownId.current = answer.body.id;
      setSos({ state: "sent", at: clock(answer.body.sent_at), safe: answer.body.safe });
      // A closer reading, once the phone has it, brings the SOS up to date; it raises nothing again.
      const id = answer.body.id;
      void readPosition("close").then((close) => (close === null ? undefined : api.sosPosition(id, close)));
    });
  const safe = () =>
    once(async () => {
      if (ownId.current === null) return;
      const answer = await api.sosSafe(ownId.current);
      setSafeFailed(!answer.ok);
      if (answer.ok) setSos((was) => (was.state === "sent" ? { ...was, safe: true } : was));
    });
  return { sos, sending, safeFailed, read, raise, safe };
}

/** The shield in a visit's header, and the sheet it opens. */
export function Safety({
  jobId,
  className,
}: {
  readonly jobId: string | null;
  readonly className?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const { sos, sending, safeFailed, read, raise, safe } = useSos(jobId);
  return (
    <>
      <IconButton
        className={className}
        d={GLYPHS.shield}
        size="lg"
        label={copy.open}
        onClick={() => {
          setOpen(true);
          void read();
        }}
      />
      {open && (
        <SafetySheet
          jobId={jobId}
          sos={sos}
          sending={sending}
          safeFailed={safeFailed}
          onSos={() => void raise()}
          onSafe={() => void safe()}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
