// "Book your next visit" and its kin: the booking sheet where self-serve
// booking is on, WhatsApp to ops with a message ready where it is off (ADR
// 0043), and nothing offline. Once money has moved, Home is fetched again.
//
// It books the kind of visit it is given, the first the client may book if it
// is given none, and opens the sheet with the day and window the app offers it
// on, where it is given them (ADR 0086). It is drawn as the screen's primary
// action, or quietly, as Home's prompt draws its way on.

import { Button, ButtonLink } from "@maneman/ui/Button";
import { useState } from "react";
import type { BookableType } from "../api.ts";
import { whatsappWith } from "../lib/whatsapp.ts";
import { useSession } from "../session.ts";
import { BookingSheet, type Offered } from "./BookingSheet.tsx";

export function BookButton({
  label,
  message,
  className,
  type,
  offer,
  from,
  quiet = false,
}: {
  label: string;
  message: string;
  className?: string;
  /** The kind of visit it books; the first the client may book, if left out. */
  type?: BookableType;
  /** The day and window the app offers it on, which the sheet opens with chosen. */
  offer?: Offered;
  /** The strip's first day, where it should not start from the first day open. */
  from?: string;
  /** Drawn as a quiet way on, as Home's prompt draws one, rather than as the screen's primary action. */
  quiet?: boolean;
}) {
  const { me, offline, refresh } = useSession();
  const [open, setOpen] = useState(false);
  const kind = type ?? me.booking.types[0];
  const words = quiet ? <span>{label}</span> : label;
  if (offline) {
    return quiet ? (
      <button type="button" className={className} disabled>
        {words}
      </button>
    ) : (
      <Button variant="primary" size="action" className={className} disabled>
        {label}
      </Button>
    );
  }
  if (!me.booking.self_serve || kind === undefined) {
    return quiet ? (
      <a className={className} href={whatsappWith(message)} rel="noopener">
        {words}
      </a>
    ) : (
      <ButtonLink variant="primary" size="action" className={className} href={whatsappWith(message)} rel="noopener">
        {label}
      </ButtonLink>
    );
  }
  const onClick = () => {
    setOpen(true);
  };
  return (
    <>
      {quiet ? (
        <button type="button" className={className} onClick={onClick}>
          {words}
        </button>
      ) : (
        <Button variant="primary" size="action" className={className} onClick={onClick}>
          {label}
        </Button>
      )}
      {open && (
        <BookingSheet
          type={kind}
          {...(offer === undefined ? {} : { offer })}
          {...(from === undefined ? {} : { from })}
          onClose={(changed) => {
            setOpen(false);
            if (changed) refresh();
          }}
        />
      )}
    </>
  );
}
