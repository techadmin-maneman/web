// What the Closed screen offers beyond the visit's summary (docs/decisions/0246-closed-and-sent-back.md): a one
// visit's payment link and texting it again, finishing a visit left partly done, and the next job. Each call is asked
// straight, with signal; what it came to is said beneath it.

import { GLYPHS } from "@maneman/brand/icons";
import { Button, ButtonLink } from "@maneman/ui/Button";
import { Icon } from "@maneman/ui/Icon";
import { SectionHead } from "@maneman/ui/SectionHead";
import { ToggleButton } from "@maneman/ui/ToggleButton";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useState } from "react";
import { api, unreachable, type FinishAsk, type Job, type JobSummary } from "../api.ts";
import { closeOut as copy, job as jobCopy } from "../content.ts";
import { kindName } from "../lib/kind.ts";
import { wayTo } from "../lib/navigate.ts";
import { clock } from "../lib/when.ts";
import styles from "./close-out.module.css";

const ASKS: readonly FinishAsk[] = ["tomorrow_morning", "tomorrow_evening", "ops_call"];

/** A one visit's link: paid, or sent and not paid, with Resend and what sending it again came to. */
export function PaymentLink({ job, link }: { job: Job; link: NonNullable<Job["payment_link"]> }) {
  const [said, setSaid] = useState<string | null>(null);
  const [busy, once] = useOneAtATime();
  const resend = () =>
    once(async () => {
      const answer = await api.resendLink(job.id);
      if (answer.ok) setSaid(copy.payment.said[answer.body.outcome]);
      else if (unreachable(answer)) setSaid(copy.payment.failed.offline);
      else setSaid(answer.code === "rate_limited" ? copy.payment.failed.rate_limited : copy.payment.failed.unknown);
    });
  return (
    <section className={styles.section} aria-labelledby="closed-payment">
      <SectionHead id="closed-payment" title={copy.payment.title} />
      <div className={styles.linkLine}>
        <span className={link.paid ? styles.paid : styles.notPaid}>
          {link.paid ? copy.payment.paid : copy.payment.notPaid}
        </span>
        {!link.paid && (
          <Button variant="outline" size="control" busy={busy} onClick={() => void resend()}>
            {busy ? copy.payment.sending : copy.payment.resend}
          </Button>
        )}
      </div>
      {said !== null && (
        <p className={styles.said} role="status">
          {said}
        </p>
      )}
    </section>
  );
}

/** A visit left partly done, or not fitted: how the technician suggests finishing it, for ops to book. */
export function FinishTheWork({ job }: { job: Job }) {
  const [asked, setAsked] = useState<FinishAsk | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [, once] = useOneAtATime();
  const ask = (what: FinishAsk) =>
    once(async () => {
      const answer = await api.finishAsk(job.id, what);
      if (answer.ok) setAsked(what);
      setSaid(answer.ok ? copy.finish.sent : copy.finish.failed);
    });
  return (
    <section className={styles.section} aria-labelledby="closed-finish">
      <SectionHead id="closed-finish" title={copy.finish.title} />
      <p className={styles.note}>{copy.finish.ask}</p>
      <div className={styles.asks}>
        {ASKS.map((each) => (
          <ToggleButton key={each} filled pressed={asked === each} onClick={() => void ask(each)}>
            {copy.finish.asks[each]}
          </ToggleButton>
        ))}
      </div>
      {said !== null && (
        <p className={styles.said} role="status">
          {said}
        </p>
      )}
    </section>
  );
}

/** The next job: when to leave for it, when it starts and whose it is. */
export function NextUp({ next, name }: { next: JobSummary; name: string }) {
  return (
    <section className={styles.section} aria-labelledby="closed-next">
      <SectionHead
        id="closed-next"
        title={copy.next.title}
        end={next.leave_by === null ? undefined : copy.next.leaveBy(clock(next.leave_by))}
      />
      <p className={styles.nextWho}>{`${clock(next.starts_at)} · ${name}`}</p>
      <p className={styles.note}>{kindName(next)}</p>
    </section>
  );
}

/** Navigate to the next job, beside the way back to Today. */
export function NavigateNext({ next }: { next: JobSummary }) {
  if (next.address === null) return null;
  return (
    // A new tab, so a technician who has taken the route back still has the app open behind it.
    <ButtonLink
      variant="primary"
      size="action"
      className={styles.navigate}
      href={wayTo(next.address)}
      target="_blank"
      rel="noopener noreferrer"
    >
      <Icon d={GLYPHS.navigate} size="md" />
      <span>{jobCopy.navigate}</span>
    </ButtonLink>
  );
}
