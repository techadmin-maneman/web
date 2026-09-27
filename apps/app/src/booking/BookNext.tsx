// The way to book the next visit, beneath Home's card and at the foot of Visits (ADR 0025, item 69;
// docs/decisions/0086-the-next-visit-is-offered.md). The visit the app offers comes first, in the sheet with its day
// and window chosen: the first fit once the consultation is done, the next service once a visit is, or the
// replacement where the piece falls due first. A fitted client may book either a service or a replacement, so the
// other is beside it, quietly: the client chooses, and neither is booked by WhatsApp.

import type { BookableType } from "../api.ts";
import { home, messages } from "../content.ts";
import { useSession } from "../session.ts";
import { BookButton } from "./BookButton.tsx";

/** The other kind of visit a fitted client may book beside the one offered; none beside a consultation or a fit. */
const OTHER_KIND: Readonly<Partial<Record<BookableType, BookableType>>> = {
  service: "replacement",
  replacement: "service",
};

/** What the primary button says, and the message WhatsApp opens with while self-serve booking is off. */
function wordsFor(type: BookableType | undefined): { label: string; message: string } {
  if (type === "first_fit") return { label: home.next.bookFirstFit, message: messages.bookFirstFit };
  if (type === "replacement") return { label: home.next.bookReplacement, message: messages.bookReplacement };
  return { label: home.next.book, message: messages.book };
}

export function BookNext({ className, otherClassName }: { className?: string; otherClassName?: string }) {
  const { me } = useSession();
  const next = me.booking.next;
  const type = next?.type ?? me.booking.types[0];
  const offer = next === null ? undefined : { date: next.date, window: next.window };
  // A service and a replacement are each open to a fitted client; the one not offered is the other choice.
  const other = type === undefined ? undefined : OTHER_KIND[type];
  const { label, message } = wordsFor(type);
  return (
    <>
      <BookButton
        className={className}
        label={label}
        message={message}
        {...(type === undefined ? {} : { type })}
        {...(offer === undefined ? {} : { offer })}
      />
      {other !== undefined && me.booking.types.includes(other) && (
        <BookButton
          quiet
          className={otherClassName}
          type={other}
          label={other === "replacement" ? home.next.orReplacement : home.next.orService}
          message={other === "replacement" ? messages.bookReplacement : messages.book}
        />
      )}
    </>
  );
}
