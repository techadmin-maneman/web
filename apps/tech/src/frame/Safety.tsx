// The Safety sheet, from the shield in a visit's header (docs/prompts/tech-redesign.md, "Safety"): that ops can see the
// technician's location until the visit closes, the SOS held for three seconds, which alerts ops and shares where they
// are, and ops' line and 112. Once sent it says when, and "I'm safe" tells ops so.

import { GLYPHS } from "@maneman/brand/icons";
import { Button, ButtonLink } from "@maneman/ui/Button";
import { HoldButton } from "@maneman/ui/HoldButton";
import { IconButton } from "@maneman/ui/IconButton";
import { Sheet, SheetClose, SheetPanel } from "@maneman/ui/Sheet";
import { OPS_NUMBER } from "@maneman/web-kit/whatsapp";
import { useId, useState } from "react";
import { ops, safety as copy } from "../content.ts";
import styles from "./safety.module.css";

/** Where an SOS stands on this phone: not sent, sent at a time, refused, or the technician said they are safe. */
export type SosState =
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
      <SheetClose quiet onClose={onClose}>
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

/** The shield in a visit's header, and the sheet it opens. */
export function Safety({
  sos,
  onSos,
  onSafe,
  className,
}: {
  readonly sos: SosState;
  readonly onSos: () => void;
  readonly onSafe: () => void;
  readonly className?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton
        className={className}
        d={GLYPHS.shield}
        size="lg"
        label={copy.open}
        onClick={() => {
          setOpen(true);
        }}
      />
      {open && (
        <SafetySheet
          sos={sos}
          onSos={onSos}
          onSafe={onSafe}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
