// Me's two figures sections (docs/prompts/tech-redesign.md, "Me"): the technician's quality over the last 30 days, the
// hairline redo rate and visits on time (src/routes/tech/quality.ts); and this month's incentives, a line a kind of
// visit, its count and the rate a visit, with the total (src/routes/tech/month.ts). Incentives a visit, not pay. The
// client rating follows once ratings exist. Each says when it is loading, and when it would not load, with Try again.

import { ErrorRef } from "@maneman/ui/ErrorRef";
import { SectionHead } from "@maneman/ui/SectionHead";
import { TextButton } from "@maneman/ui/TextLink";
import { type Loaded, useLoad } from "@maneman/ui/useLoad";
import { fullMonth } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import type { ReactNode } from "react";
import { api } from "../api.ts";
import { me, month as monthCopy, reference } from "../content.ts";
import { dayMonth, todayInIndia } from "../lib/when.ts";
import styles from "./me.module.css";

function Line({ term, value }: { readonly term: ReactNode; readonly value: string }) {
  return (
    <div className={styles.line}>
      <dt>{term}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** A section's loading line, or its failure with Try again and the reference to quote to ops; nothing once loaded. */
function Waiting(props: { readonly loaded: Loaded<unknown>; readonly failed: string; readonly onRetry: () => void }) {
  if (props.loaded.state === "loading") return <p className={styles.quiet}>{me.loading}</p>;
  if (props.loaded.state !== "failed") return null;
  return (
    <div className={styles.quiet} role="alert">
      <p className={styles.failedLine}>{props.failed}</p>
      <TextButton onClick={props.onRetry}>{me.retry}</TextButton>
      {props.loaded.requestId !== null && <ErrorRef requestId={props.loaded.requestId} words={reference} />}
    </div>
  );
}

export function Quality() {
  const [loaded, retry] = useLoad(api.quality);
  const copy = me.quality;
  return (
    <section className={styles.section} aria-labelledby="me-quality">
      <SectionHead id="me-quality" title={copy.title} end={copy.days} />
      <Waiting loaded={loaded} failed={copy.failed} onRetry={retry} />
      {loaded.state === "loaded" && (
        <dl className={styles.lines}>
          <Line
            term={copy.redo}
            value={loaded.value.fits === 0 ? copy.none : copy.redone(loaded.value.redone, loaded.value.fits)}
          />
          <Line
            term={copy.onTime}
            value={loaded.value.visits === 0 ? copy.none : copy.onTimeShare(loaded.value.on_time, loaded.value.visits)}
          />
        </dl>
      )}
    </section>
  );
}

export function Incentives() {
  const [loaded, retry] = useLoad(api.month);
  const copy = me.incentives;
  const today = todayInIndia();
  const month = fullMonth(today.slice(0, 7)).split(" ")[0] ?? "";
  const lines = loaded.state === "loaded" ? loaded.value.lines : [];
  const total = lines.reduce((sum, line) => sum + (line.amount ?? 0), 0);
  return (
    <section className={styles.section} aria-labelledby="me-incentives">
      <SectionHead id="me-incentives" title={copy.title(month)} end={copy.upTo(dayMonth(today))} />
      <Waiting loaded={loaded} failed={copy.failed} onRetry={retry} />
      {loaded.state === "loaded" && lines.length === 0 && <p className={styles.quiet}>{copy.none}</p>}
      {lines.length > 0 && (
        <>
          <p className={styles.total}>{rupees(total)}</p>
          <dl className={styles.lines}>
            {lines.map((line) => (
              <Line
                key={`${line.kind}/${line.city ?? ""}/${String(line.rate)}`}
                term={
                  <>
                    {copy.line(monthCopy.kinds[line.kind], line.visits, null)}
                    {line.rate !== null && (
                      <>
                        {" · "}
                        <span className={styles.figure}>{rupees(line.rate)}</span>
                      </>
                    )}
                  </>
                }
                value={line.amount === null ? copy.noRate : rupees(line.amount)}
              />
            ))}
          </dl>
        </>
      )}
    </section>
  );
}
