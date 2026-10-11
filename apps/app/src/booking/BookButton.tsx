// "Book your next visit" and its kin: the booking sheet where self-serve
// booking is on, WhatsApp to ops with a message ready where it is off (ADR
// 0043), and nothing offline. Once money has moved, Home is fetched again.
//
// It books the kind of visit it is given, the first the client may book if it
// is given none, and opens the sheet with the day and window the app offers it
// on, where it is given them (ADR 0086). The sheet offers every service of that
// kind ops offer, or of every kind open to the client where it is given none
// (ADR 0085), with the one the app offers chosen where it is given one. It is
// drawn as the screen's primary action, or quietly, as Home's prompt draws its
// way on. A first fit while ops offer no hair system is not bookable at all,
// and says so in place of the button.

import { Button, ButtonLink } from "@maneman/ui/Button";
import { useState } from "react";
import type { BookableType, Me } from "../api.ts";
import { booking } from "../content.ts";
import { whatsappWith } from "../lib/whatsapp.ts";
import { useSession } from "../session.ts";
import { BookingSheet, type Offered } from "./BookingSheet.tsx";
import type { Recommended } from "./steps/ServiceStep.tsx";
import { firstNameOf } from "../../../../src/lib/names.ts";

/** The hair system the client's consultation recommended, and who recommended it; none before one is recorded. */
function recommendationOf(me: Me): Recommended | undefined {
  const tier = me.consulted?.recommended ?? null;
  if (tier === null) return undefined;
  const technician = me.consulted?.technician ?? null;
  return { tier, by: technician === null ? null : firstNameOf(technician.name) };
}

export function BookButton({
  label,
  message,
  className,
  type,
  tier,
  offer,
  from,
  quiet = false,
}: {
  label: string;
  message: string;
  className?: string;
  /** The kind of visit it books; the first the client may book, if left out. */
  type?: BookableType;
  /** The service of that kind the app offers, which the sheet opens with chosen (ADR 0085); null for none. */
  tier?: string | null;
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
  const services =
    type === undefined ? me.booking.services : me.booking.services.filter((service) => service.type === type);
  const words = quiet ? <span>{label}</span> : label;
  if (kind === "first_fit" && !services.some((service) => service.type === "first_fit")) {
    return <p>{booking.firstFitNotYet}</p>;
  }
  // A sheet already open stays open when the connection drops, with its hold and any payment under way.
  if (offline && !open) {
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
          services={services}
          tier={tier ?? undefined}
          recommended={kind === "first_fit" ? recommendationOf(me) : undefined}
          offer={offer}
          from={from}
          onClose={(changed) => {
            setOpen(false);
            if (changed) refresh();
          }}
        />
      )}
    </>
  );
}
