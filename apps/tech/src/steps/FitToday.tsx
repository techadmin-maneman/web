// Fit today on a plain consultation's Closed screen (docs/decisions/0299-fit-today.md): where the client said they are
// going ahead, the kit holds a piece made exactly to their profile and the day has room, the fit is offered, with when it
// would start and how the client pays, and booked with signal; the new job's card opens at once. Nothing shows where it
// is not offered, or with no signal to ask. How a booking ended stays while the app is open, as the section and the
// close's Fit row both say it, so a read again after it never undoes what was said.

import { Button } from "@maneman/ui/Button";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { SectionHead } from "@maneman/ui/SectionHead";
import { useLoad } from "@maneman/ui/useLoad";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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

/** How a booking at a close ended: booked, booked with its job on its way, or refused for good, and in what words. */
interface Ending {
  readonly kind: "booked" | "soon" | "refused";
  readonly words: string;
}

/** Each close's ending, while the app is open, and who is showing one. */
const endings = new Map<string, Ending>();
const showing = new Set<() => void>();
function end(jobId: string, ending: Ending): void {
  endings.set(jobId, ending);
  for (const tell of showing) tell();
}
function hear(tell: () => void): () => void {
  showing.add(tell);
  return () => showing.delete(tell);
}

/** Fit today at a close: whether its offer has been answered, the offer, and whether a fit is booked or was refused. */
export interface FitTodayAt {
  readonly answered: boolean;
  readonly offer: FitTodayOffer | null;
  /** A fit booked: at this close, or already, as the API says of a client's fit to come. */
  readonly booked: boolean;
  readonly ending: Ending | null;
}

/** Fit today's state for a consultation the client is going ahead from; nothing asked for any other close. */
export function useFitToday(job: Job, goingAhead: boolean): FitTodayAt {
  const asks = goingAhead && job.type === "consultation" && !job.one_visit;
  const [loaded] = useLoad(asks ? readOf(job.id) : NONE);
  const ending = useSyncExternalStore(hear, () => endings.get(job.id) ?? null);
  const answer = loaded.state === "loaded" ? loaded.value : null;
  const booked = ending?.kind === "booked" || ending?.kind === "soon" || answer?.refusal === "fit_booked";
  return { answered: loaded.state !== "loading", offer: answer?.offer ?? null, booked, ending };
}

/** How a booking the API refused ended: already booked, the day full, or nothing to book now; null to try again. */
function endingOf(answer: { readonly status: number; readonly code: string }): Ending | null {
  if (answer.code === "offline" || answer.status >= 500) return null;
  if (answer.code === "already_booked") return { kind: "booked", words: copy.alreadyBooked };
  return { kind: "refused", words: answer.code === "taken" ? copy.failed.taken : copy.failed.gone };
}

/** How it ended, with the focus moved to it where it ended on this screen, so a reader hears it. */
function Ended({ ending, focus }: { readonly ending: Ending; readonly focus: boolean }) {
  const said = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus) said.current?.focus();
  }, [focus]);
  return (
    <div ref={said} tabIndex={-1} className={styles.fitEnded}>
      {ending.kind === "refused" ? (
        <InlineMessage tone="error">{ending.words}</InlineMessage>
      ) : (
        <p className={styles.said} role="status">
          {ending.words}
        </p>
      )}
    </div>
  );
}

export function FitToday({ job }: { readonly job: Job }) {
  const { offer, ending } = useFitToday(job, true);
  const [ended, setEnded] = useState(false);
  const [retry, setRetry] = useState<string | null>(null);
  const [busy, once] = useOneAtATime();
  const book = () =>
    once(async () => {
      const answer = await api.bookFitToday(job.id);
      if (answer.ok) {
        const visitId = answer.body.visit_id;
        end(
          job.id,
          visitId === null ? { kind: "soon", words: copy.bookedSoon } : { kind: "booked", words: copy.booked },
        );
        if (visitId !== null) go(`/jobs/${visitId}`);
        else setEnded(true);
        return;
      }
      const ending = endingOf(answer);
      if (ending === null) {
        setRetry(answer.code === "offline" ? copy.failed.offline : copy.failed.unknown);
        return;
      }
      end(job.id, ending);
      setEnded(true);
    });
  if (ending !== null) {
    return (
      <section className={styles.section} aria-labelledby="closed-fit-today">
        <SectionHead id="closed-fit-today" title={copy.title} />
        <Ended ending={ending} focus={ended} />
      </section>
    );
  }
  if (offer === null) return null;
  return (
    <section className={styles.section} aria-labelledby="closed-fit-today">
      <SectionHead id="closed-fit-today" title={copy.title} />
      <p className={styles.fitLine}>{copy.line(offer.stock_name, keptWhole(clock(offer.starts_at)))}</p>
      <p className={styles.fitPays}>{offer.pays_by === "link" ? copy.paysLink : copy.paysAtVisit}</p>
      <Button
        variant="outline"
        size="action"
        busy={busy}
        onClick={() => {
          setRetry(null);
          void book();
        }}
      >
        {busy ? copy.booking : copy.action}
      </Button>
      {retry !== null && (
        <InlineMessage tone="error" className={styles.fitRefused}>
          {retry}
        </InlineMessage>
      )}
    </section>
  );
}
