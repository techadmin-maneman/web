// "Book your next visit" and its kin: the booking sheet where self-serve
// booking is on, WhatsApp to ops with a message ready where it is off (ADR
// 0043), and nothing offline. Booked, Home is fetched again.

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
      <button className={className} type="button" disabled>
        {label}
      </button>
    );
  }
  if (!me.booking.self_serve || type === undefined) {
    return (
      <a className={className} href={whatsappWith(message)} rel="noopener">
        {label}
      </a>
    );
  }
  return (
    <>
      <button
        className={className}
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        {label}
      </button>
      {open && (
        <BookingSheet
          type={type}
          onClose={(booked) => {
            setOpen(false);
            if (booked) refresh();
          }}
        />
      )}
    </>
  );
}
