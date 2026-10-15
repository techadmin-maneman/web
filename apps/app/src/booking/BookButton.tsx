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

import { TextButton, TextLink } from "@maneman/ui/TextLink";
import { Button, ButtonLink } from "@maneman/ui/Button";
import { weekdayDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useState } from "react";
import type { BookableType, Me } from "../api.ts";
import { booking } from "../content.ts";
import { whatsappWith } from "../lib/whatsapp.ts";
import { useSession } from "../session.ts";
import type { Offered } from "./BookingSheet.tsx";
import { BookingSheet } from "./lazy-sheet.tsx";
import type { Recommended } from "./steps/ServiceStep.tsx";
import { firstNameOf } from "@rules/lib/names.ts";

/** The hair system the client's consultation recommended, and who recommended it; none before one is recorded. */
function recommendationOf(me: Me): Recommended | undefined {
  const tier = me.consulted?.recommended ?? null;
  if (tier === null) return undefined;
  const technician = me.consulted?.technician ?? null;
  return { tier, by: technician === null ? null : firstNameOf(technician.name) };
}

/**
 * A paid visit booked with ops on WhatsApp: the message names the service and the day the app offered, and the main
 * button says it is paid by UPI at the visit.
 */
function WithOps(props: {
  label: string;
  className: string | undefined;
  message: string;
  services: Me["booking"]["services"];
  tier: string | null | undefined;
  offer: Offered | undefined;
  quiet: boolean;
}) {
  const service = props.services.find((each) => each.tier === props.tier) ?? props.services[0];
  const day = props.offer === undefined ? null : weekdayDate(props.offer.date);
  const href = whatsappWith(booking.asking(props.message, service?.name ?? null, day));
  if (props.quiet) {
    return (
      <TextLink tone="brass" className={props.className} href={href}>
        {props.label}
      </TextLink>
    );
  }
  return (
    <>
      <ButtonLink variant="primary" size="action" className={props.className} href={href} rel="noopener">
        {props.label}
      </ButtonLink>
      {service !== undefined && <p>{booking.withOps(rupees(service.price.amount))}</p>}
    </>
  );
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
  /** The service of that kind the app offers, which the sheet opens with chosen; null for none. */
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
  if (kind === "first_fit" && !services.some((service) => service.type === "first_fit")) {
    return <p>{booking.firstFitNotYet}</p>;
  }
  // A sheet already open stays open when the connection drops, with its hold and any payment under way.
  if (offline && !open) {
    return quiet ? (
      <TextButton tone="brass" className={className} disabled>
        {label}
      </TextButton>
    ) : (
      <Button variant="primary" size="action" className={className} disabled>
        {label}
      </Button>
    );
  }
  // A kind the client may not book themselves goes to ops on WhatsApp: every paid visit, while online payment is off.
  if (kind === undefined || !me.booking.self_serve_kinds.includes(kind)) {
    return <WithOps {...{ label, className, message, services, tier, offer, quiet }} />;
  }
  const onClick = () => {
    setOpen(true);
  };
  return (
    <>
      {quiet ? (
        <TextButton tone="brass" className={className} onClick={onClick}>
          {label}
        </TextButton>
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
