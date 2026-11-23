// Fit today on a plain consultation's Closed screen (docs/decisions/0299-fit-today.md): where the client said they are
// going ahead, the kit holds a piece made exactly to their profile and the day has room, the fit is offered, with when it
// would start and how the client pays, and booked with signal; the new job's card opens at once. Nothing shows where it
// is not offered, or with no signal to ask. A booking refused for good takes the button away and says why.

import { Button } from "@maneman/ui/Button";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { SectionHead } from "@maneman/ui/SectionHead";
import { useLoad } from "@maneman/ui/useLoad";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useState } from "react";
import { api, type FitTodayOffer, type Job } from "../api.ts";
import { closeOut } from "../content.ts";
import { keptWhole } from "../lib/today.ts";
import { clock } from "../lib/when.ts";
import { go } from "../route.ts";
import styles from "./close-out.module.css";

const copy = closeOut.fitToday;

type Read = () => ReturnType<typeof api.fitToday>;

/** Nothing offered, for a close that is no consultation going ahead: nothing is asked. */
const NONE: Read = () =>
  Promise.resolve({ ok: true as const, status: 200, body: { offer: null, refusal: null }, cached: false });

/**
 * The offer's read, one for each job, so the Fit row and this section, read together, share one answer: the second
 * read while the first is on its way takes its answer.
 */
const reads = new Map<string, Read>();
function readOf(jobId: string): Read {
  const known = reads.get(jobId);
  if (known !== undefined) return known;
  let asking: ReturnType<Read> | null = null;
  const read: Read = () => {
    asking ??= api.fitToday(jobId).finally(() => {
      asking = null;
    });
    return asking;
  };
  reads.set(jobId, read);
  return read;
}

/** Fit today's offer for a consultation the client is going ahead from; null where there is none, or none to ask. */
export function useFitToday(job: Job, goingAhead: boolean): FitTodayOffer | null {
  const asks = goingAhead && job.type === "consultation" && !job.one_visit;
  const [loaded] = useLoad(asks ? readOf(job.id) : NONE);
  return loaded.state === "loaded" ? loaded.value.offer : null;
}

/** What a booking refused for good says: the day full, or nothing to book now. */
const settledBy = (code: string): string => (code === "taken" ? copy.failed.taken : copy.failed.gone);

export function FitToday({ job }: { readonly job: Job }) {
  const offer = useFitToday(job, true);
  const [said, setSaid] = useState<{ readonly words: string; readonly done: boolean } | null>(null);
  const [busy, once] = useOneAtATime();
  if (offer === null) return null;
  const book = () =>
    once(async () => {
      const answer = await api.bookFitToday(job.id);
      if (answer.ok && answer.body.visit_id !== null) {
        go(`/jobs/${answer.body.visit_id}`);
        return;
      }
      // Booked, its visit on its way: the half-hour pass books what this request could not.
      if (answer.ok) setSaid({ words: copy.bookedSoon, done: true });
      else if (answer.code === "offline") setSaid({ words: copy.failed.offline, done: false });
      else if (answer.status >= 500) setSaid({ words: copy.failed.unknown, done: false });
      else setSaid({ words: settledBy(answer.code), done: true });
    });
  return (
    <section className={styles.section} aria-labelledby="closed-fit-today">
      <SectionHead id="closed-fit-today" title={copy.title} />
      <p className={styles.fitLine}>{copy.line(offer.stock_name, keptWhole(clock(offer.starts_at)))}</p>
      <p className={styles.fitPays}>{offer.pays_by === "link" ? copy.paysLink : copy.paysAtVisit}</p>
      {said?.done !== true && (
        <Button
          variant="outline"
          size="action"
          busy={busy}
          onClick={() => {
            setSaid(null);
            void book();
          }}
        >
          {busy ? copy.booking : copy.action}
        </Button>
      )}
      {said !== null &&
        (said.done && said.words === copy.bookedSoon ? (
          <p className={styles.said} role="status">
            {said.words}
          </p>
        ) : (
          <InlineMessage tone="error" className={styles.fitRefused}>
            {said.words}
          </InlineMessage>
        ))}
    </section>
  );
}
