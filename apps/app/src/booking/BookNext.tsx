// The way to book the next visit, beneath Home's card and at the foot of Visits. The visit the app offers comes
// first, in the sheet with its day and window chosen: the first fit once the consultation is done, the next service
// once a visit is, or the replacement where the piece falls due first. On Visits a fitted client may book either a
// service or a replacement, so the other is beside it, quietly; Home offers the other only in its prompt.

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

export function BookNext({
  className,
  otherClassName,
  offerOther = true,
}: {
  className?: string;
  otherClassName?: string;
  /** Whether the other kind of visit a fitted client may book is offered beside the one the app offers. */
  offerOther?: boolean;
}) {
  const { me } = useSession();
  const next = me.booking.next;
  const type = next?.type ?? me.booking.types[0];
  const offer = next === null ? undefined : { date: next.date, window: next.window };
  // The service it is offered as, which the sheet opens with chosen where its kind offers more than one (ADR 0085).
  const tier = next?.tier;
  // A service and a replacement are each open to a fitted client; the one not offered is the other choice.
  const other = type === undefined || !offerOther ? undefined : OTHER_KIND[type];
  const { label, message } = wordsFor(type);
  return (
    <>
      <BookButton
        className={className}
        label={label}
        message={message}
        {...(type === undefined ? {} : { type })}
        {...(tier === undefined || tier === null ? {} : { tier })}
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
