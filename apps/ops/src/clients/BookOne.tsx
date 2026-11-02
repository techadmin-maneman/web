// Book a visit from any button on a client's page: the head's, and the Visits tab's when nothing is to come. Each
// opens the one panel (./BookVisit.tsx); a visit booked, or a link sent, has the page read the record again, and a
// panel closed with nothing booked hands the keyboard back to the button that opened it.

import { useState, type ReactNode } from "react";
import type { ClientRecord } from "../api.ts";
import { useAccess } from "../lib/access.ts";
import { BookVisit } from "./BookVisit.tsx";
import type { Choice } from "./book-slot.ts";

/**
 * What Book a visit opens on: what the client app offers them next, a replacement where the piece falls due first;
 * else a fitted client's service, a consulted lead's first fit, anyone else's consultation.
 */
function firstChoiceOf(record: ClientRecord): Choice {
  if (record.next_visit !== null) return record.next_visit.type;
  if (record.state === "fitted") return "service";
  const consulted = record.visits.past.some((visit) => visit.type === "consultation" && visit.status === "completed");
  return consulted ? "first_fit" : "consultation";
}

export interface Booking {
  /** Whether the person may book: no button offers it otherwise. */
  readonly mayBook: boolean;
  readonly open: (from: HTMLElement) => void;
  /** The panel, while it is open. */
  readonly panel: ReactNode;
}

export function useBookVisit(clientId: string, record: ClientRecord, onBooked: () => void): Booking {
  const [from, setFrom] = useState<HTMLElement | null>(null);
  const mayBook = useAccess().mayCall("POST /api/visits");
  const panel =
    from === null ? null : (
      <BookVisit
        clientId={clientId}
        name={record.name}
        prefill={{ choice: firstChoiceOf(record), replacing: record.history.replacement_due?.piece_code }}
        onClose={(booked) => {
          setFrom(null);
          if (booked !== null) onBooked();
          else
            requestAnimationFrame(() => {
              from.focus();
            });
        }}
      />
    );
  return { mayBook, open: setFrom, panel };
}
