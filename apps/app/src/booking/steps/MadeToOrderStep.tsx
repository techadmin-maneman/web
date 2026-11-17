// A fit whose hair system is made to order in the client's size (docs/decisions/0253-replacement-when-due-and-change-of-hair-system.md):
// no days are offered. The step sends ops the client's ask as it opens, a task on their board, and says we'll order it
// and message them; where the ask cannot reach us, the client asks on WhatsApp instead.

import { Button, ButtonLink } from "@maneman/ui/Button";
import { TextLink } from "@maneman/ui/TextLink";
import { useEffect, useState } from "react";
import { api, type OfferedService } from "../../api.ts";
import { booking } from "../../content.ts";
import { whatsappWith } from "../../lib/whatsapp.ts";
import bookingSheet from "../booking.module.css";
import styles from "./outcome-steps.module.css";
import { Frame, TITLE_ID } from "./shared.tsx";

/** Where the ask stands: on its way, with ops, or not sent, so the client sends it on WhatsApp. */
type Ask = "asking" | "asked" | "failed";

/** `service`: the visit asked for, whose hair system is made to order; null where the sheet cannot say. */
export function MadeToOrderStep(props: {
  service: OfferedService | null;
  onBack: (() => void) | undefined;
  onClose: () => void;
}) {
  const copy = booking.madeToOrder;
  const { service } = props;
  const kind = service?.type === "first_fit" || service?.type === "replacement" ? service.type : null;
  const tier = service?.tier ?? null;
  const [sent, setSent] = useState<Ask>("asking");
  const ask: Ask = kind === null || tier === null ? "failed" : sent;
  useEffect(() => {
    if (kind === null || tier === null) return;
    let current = true;
    void api.askToOrder(kind, tier).then((answer) => {
      if (current) setSent(answer.ok ? "asked" : "failed");
    });
    return () => {
      current = false;
    };
  }, [kind, tier]);
  const name = service?.name ?? null;
  return (
    <Frame
      onBack={props.onBack}
      onClose={props.onClose}
      footer={
        ask === "failed" ? (
          <ButtonLink
            variant="primary"
            size="action"
            className={bookingSheet.primary}
            href={whatsappWith(copy.asking(name))}
            rel="noopener"
          >
            {copy.ask}
          </ButtonLink>
        ) : (
          <Button variant="primary" size="action" className={bookingSheet.primary} onClick={props.onClose}>
            {copy.done}
          </Button>
        )
      }
    >
      <div className={styles.middle} role="status">
        <h2 className={styles.title} id={TITLE_ID}>
          {copy.title}
        </h2>
        {ask === "asked" && (
          <p className={styles.line}>
            {`${copy.ordering} `}
            <TextLink inline href={whatsappWith(copy.about(name))}>
              {copy.questions}
            </TextLink>
          </p>
        )}
        {ask === "failed" && <p className={styles.line}>{copy.line}</p>}
      </div>
    </Frame>
  );
}
