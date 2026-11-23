// Fit today on a plain consultation's Closed screen (docs/decisions/0299-fit-today.md): where the kit holds a piece made
// exactly to the client's profile and the day has room, the fit is offered, with what the client pays and when, and
// booked with signal; the new job's card opens at once. Nothing shows where it is not offered, or with no signal to ask.

import { Button } from "@maneman/ui/Button";
import { SectionHead } from "@maneman/ui/SectionHead";
import { useLoad } from "@maneman/ui/useLoad";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useCallback, useState } from "react";
import { api, type Job } from "../api.ts";
import { closeOut } from "../content.ts";
import { clock } from "../lib/when.ts";
import { go } from "../route.ts";
import styles from "./close-out.module.css";

const copy = closeOut.fitToday;

export function FitToday({ job }: { readonly job: Job }) {
  const load = useCallback(() => api.fitToday(job.id), [job.id]);
  const [loaded] = useLoad(load);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, once] = useOneAtATime();
  if (loaded.state !== "loaded" || loaded.value.offer === null) return null;
  const offer = loaded.value.offer;
  const book = () =>
    once(async () => {
      const answer = await api.bookFitToday(job.id);
      if (answer.ok && answer.body.visit_id !== null) {
        go(`/jobs/${answer.body.visit_id}`);
        return;
      }
      if (answer.ok) setSaid(copy.failed.unknown);
      else if (answer.code === "offline") setSaid(copy.failed.offline);
      else setSaid(answer.code === "taken" ? copy.failed.taken : copy.failed.unknown);
    });
  return (
    <section className={styles.section} aria-labelledby="closed-fit-today">
      <SectionHead id="closed-fit-today" title={copy.title} />
      <p className={styles.fitLine}>{copy.line(offer.stock_name, clock(offer.starts_at))}</p>
      <p className={styles.fitPays}>{copy.pays}</p>
      <Button
        variant="primary"
        size="action"
        busy={busy}
        onClick={() => {
          setSaid(null);
          void book();
        }}
      >
        {busy ? copy.booking : copy.action}
      </Button>
      {said !== null && (
        <p className={styles.said} role="status">
          {said}
        </p>
      )}
    </section>
  );
}
