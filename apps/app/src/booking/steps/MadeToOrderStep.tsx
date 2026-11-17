// A fit whose hair system is made to order in the client's size (docs/decisions/0253-replacement-when-due-and-change-of-hair-system.md):
// no days are offered, since ops order it, take its payment and book the fitting on WhatsApp; the step says so, and
// opens WhatsApp to ask.

import { ButtonLink } from "@maneman/ui/Button";
import { booking } from "../../content.ts";
import { whatsappWith } from "../../lib/whatsapp.ts";
import bookingSheet from "../booking.module.css";
import styles from "./outcome-steps.module.css";
import { Frame, TITLE_ID } from "./shared.tsx";

/** `name`: the visit asked for, as the message to ops names it; null where the sheet cannot say. */
export function MadeToOrderStep(props: { name: string | null; onBack: (() => void) | undefined; onClose: () => void }) {
  const copy = booking.madeToOrder;
  return (
    <Frame
      onBack={props.onBack}
      onClose={props.onClose}
      footer={
        <ButtonLink
          variant="primary"
          size="action"
          className={bookingSheet.primary}
          href={whatsappWith(copy.asking(props.name))}
          rel="noopener"
        >
          {copy.ask}
        </ButtonLink>
      }
    >
      <div className={styles.middle} role="status">
        <h2 className={styles.title} id={TITLE_ID}>
          {copy.title}
        </h2>
        <p className={styles.line}>{copy.line}</p>
      </div>
    </Frame>
  );
}
