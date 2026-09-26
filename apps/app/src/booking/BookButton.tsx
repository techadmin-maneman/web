// "Book your next visit" and its kin: the booking sheet where self-serve
// booking is on, WhatsApp to ops with a message ready where it is off (ADR
// 0043), and nothing offline. Once money has moved, Home is fetched again.

import { Button, ButtonLink } from "@maneman/ui/Button";
import { useState } from "react";
import { whatsappWith } from "../lib/whatsapp.ts";
import { useSession } from "../session.ts";
import { BookingSheet } from "./BookingSheet.tsx";

export function BookButton({ label, message, className }: { label: string; message: string; className?: string }) {
  const { me, offline, refresh } = useSession();
  const [open, setOpen] = useState(false);
  const type = me.booking.types[0];
  if (offline) {
    return (
      <Button variant="primary" size="action" className={className} disabled>
        {label}
      </Button>
    );
  }
  if (!me.booking.self_serve || type === undefined) {
    return (
      <ButtonLink variant="primary" size="action" className={className} href={whatsappWith(message)} rel="noopener">
        {label}
      </ButtonLink>
    );
  }
  return (
    <>
      <Button
        variant="primary"
        size="action"
        className={className}
        onClick={() => {
          setOpen(true);
        }}
      >
        {label}
      </Button>
      {open && (
        <BookingSheet
          type={type}
          onClose={(changed) => {
            setOpen(false);
            if (changed) refresh();
          }}
        />
      )}
    </>
  );
}
