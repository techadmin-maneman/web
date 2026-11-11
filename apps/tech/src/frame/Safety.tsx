// The Safety sheet, from the shield in a visit's header (docs/prompts/tech-redesign.md, "Safety"): that ops can see the
// technician's location until the visit closes, the SOS held for three seconds, which alerts ops and shares where they
// are, and ops' line and 112. Once sent it says when, and "I'm safe" tells ops so.

import { GLYPHS } from "@maneman/brand/icons";
import { Button, ButtonLink } from "@maneman/ui/Button";
import { HoldButton } from "@maneman/ui/HoldButton";
import { IconButton } from "@maneman/ui/IconButton";
import { Sheet, SheetClose, SheetPanel } from "@maneman/ui/Sheet";
import { OPS_NUMBER } from "@maneman/web-kit/whatsapp";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useId, useRef, useState } from "react";
import { api } from "../api.ts";
import { ops, safety as copy } from "../content.ts";
import { buzz } from "../lib/haptics.ts";
import { clock } from "../lib/when.ts";
import { readPosition } from "../lib/where.ts";
import styles from "./safety.module.css";

/** Where an SOS stands on this phone: not sent, sent at a time (and whether they said they are safe), or refused. */
type SosState =
  | { readonly state: "none" }
  | { readonly state: "sent"; readonly at: string; readonly safe: boolean }
  | { readonly state: "failed" };

function SafetySheet({
  sos,
  onSos,
  onSafe,
  onClose,
}: {
  readonly sos: SosState;
  readonly onSos: () => void;
  readonly onSafe: () => void;
  readonly onClose: () => void;
}) {
  const titleId = useId();
  const holdId = useId();
  return (
    <Sheet labelledBy={titleId} rises={false} onClose={onClose}>
      <SheetClose onClose={onClose}>
        {copy.close}
      </SheetClose>
      <SheetPanel className={styles.panel}>
        <h2 className={styles.title} id={titleId}>
          {copy.title}
        </h2>
        <p className={styles.note}>{copy.sharing}</p>
        {sos.state === "sent" ? (
          <div className={styles.sent} role="status">
            <p className={styles.sentAt}>{copy.sent(sos.at)}</p>
            <p className={styles.note}>{sos.safe ? copy.safeSaid : copy.sentBody}</p>
            {!sos.safe && (
              <Button variant="outline" size="action" onClick={onSafe}>
                {copy.safe}
              </Button>
            )}
          </div>
        ) : (
          <>
            <HoldButton className={styles.sos} sub={copy.sosSub} describedBy={holdId} onHeld={onSos}>
              {copy.sos}
            </HoldButton>
            <p className={styles.note} id={holdId}>
              {copy.hold}
            </p>
            {sos.state === "failed" && (
              <p className={styles.failed} role="alert">
                {copy.failed}
              </p>
            )}
          </>
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
 * Where the technician's SOS stands, read from the API as the sheet opens, and the two things done from it: raised, with
 * the visit and where the phone is, straight to the API and never queued, as it must reach ops now or say it did not;
 * and "I'm safe".
 */
function useSos(jobId: string | null) {
  const [sos, setSos] = useState<SosState>({ state: "none" });
  const [busy, once] = useOneAtATime();
  const ownId = useRef<string | null>(null);
  const read = async () => {
    const answer = await api.ownSos();
    if (!answer.ok || answer.body.sos === null) return;
    ownId.current = answer.body.sos.id;
    setSos({ state: "sent", at: clock(answer.body.sos.sent_at), safe: answer.body.sos.safe });
  };
  const raise = () =>
    once(async () => {
      const answer = await api.sos(jobId, await readPosition());
      if (!answer.ok) {
        setSos({ state: "failed" });
        return;
      }
      buzz();
      ownId.current = answer.body.id;
      setSos({ state: "sent", at: clock(answer.body.sent_at), safe: answer.body.safe });
    });
  const safe = () =>
    once(async () => {
      if (ownId.current === null) return;
      const answer = await api.sosSafe(ownId.current);
      if (answer.ok && sos.state === "sent") setSos({ ...sos, safe: true });
    });
  return { sos, busy, read, raise, safe };
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
  const { sos, read, raise, safe } = useSos(jobId);
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
          sos={sos}
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
