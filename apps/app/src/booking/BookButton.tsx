// "Book your next visit" and its kin: the booking sheet where self-serve
// booking is on; where it is off, Ask for a time, whose pick goes to ops on WhatsApp (ADR
// 0043; ./RequestSheet.tsx); and nothing offline. Once money has moved, Home is fetched again.
//
// It books the kind of visit it is given, the first the client may book if it
// is given none, and opens the sheet with the day and window the app offers it
// on, where it is given them (ADR 0086). The sheet offers every service of that
// kind ops offer, or of every kind open to the client where it is given none
// (ADR 0085), with the one the app offers chosen where it is given one. It is
// drawn as the screen's primary action, or quietly, as Home's prompt draws its
// way on. A first fit while ops offer no hair system is not bookable at all,
// and says so in place of the button.

import { TextButton } from "@maneman/ui/TextLink";
import { Button } from "@maneman/ui/Button";
import { Toast } from "@maneman/ui/Toast";
import { rupees } from "@maneman/web-kit/money";
import { useState } from "react";
import type { BookableType, Me } from "../api.ts";
import { booking, VISIT_TYPES } from "../content.ts";
import { useSession } from "../session.ts";
import type { Offered } from "./BookingSheet.tsx";
import { BookingSheet } from "./lazy-sheet.tsx";
import { RequestSheet } from "./RequestSheet.tsx";
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
 * A visit booked with ops: Ask for a time, whose pick goes to them on WhatsApp with the service named, and a toast once
 * sent. The main button says what the visit costs, paid by UPI at the visit.
 */
function WithOps(props: {
  label: string;
  className: string | undefined;
  message: string;
  kind: BookableType | undefined;
  services: Me["booking"]["services"];
  tier: string | null | undefined;
  offer: Offered | undefined;
  quiet: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(0);
  const service = props.services.find((each) => each.tier === props.tier) ?? props.services[0];
  // The service by name where it names more than the kind: a replacement's hair system, not "Replacement" again.
  const named = props.kind === undefined || service?.name !== VISIT_TYPES[props.kind];
  const onClick = () => {
    setOpen(true);
  };
  return (
    <>
      {props.quiet ? (
        <TextButton tone="brass" className={props.className} onClick={onClick}>
          {props.label}
        </TextButton>
      ) : (
        <Button variant="primary" size="action" className={props.className} onClick={onClick}>
          {props.label}
        </Button>
      )}
      {!props.quiet && service !== undefined && <p>{booking.withOps(rupees(service.price.amount))}</p>}
      {open && (
        <RequestSheet
          message={props.message}
          what={named ? (service?.name ?? null) : null}
          offer={props.offer}
          onSent={() => {
            setSent((count) => count + 1);
          }}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
      {sent > 0 && (
        <Toast key={sent} fullWidth>
          {booking.request.sent}
        </Toast>
      )}
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
    return <WithOps {...{ label, className, message, kind, services, tier, offer, quiet }} />;
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
