// Me's two figures sections (docs/prompts/tech-redesign.md, "Me"): the technician's quality over the last 30 days, the
// hairline redo rate and visits on time (src/routes/tech/quality.ts); and this month's incentives, a line a kind of
// visit, its count and the rate a visit, with the total (src/routes/tech/month.ts). Incentives a visit, not pay. The
// client rating follows once ratings exist.

import { SectionHead } from "@maneman/ui/SectionHead";
import { useLoad } from "@maneman/ui/useLoad";
import { fullMonth } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { api } from "../api.ts";
import { me, month as monthCopy } from "../content.ts";
import { dayMonth, todayInIndia } from "../lib/when.ts";
import styles from "./me.module.css";

function Line({ term, value }: { readonly term: string; readonly value: string }) {
  return (
    <div className={styles.line}>
      <dt>{term}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function Quality() {
  const [loaded] = useLoad(api.quality);
  const copy = me.quality;
  return (
    <section className={styles.section} aria-labelledby="me-quality">
      <SectionHead id="me-quality" title={copy.title} end={copy.days} />
      {loaded.state === "failed" && <p className={styles.quiet}>{copy.failed}</p>}
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
  const [loaded] = useLoad(api.month);
  const copy = me.incentives;
  const today = todayInIndia();
  const month = fullMonth(today.slice(0, 7)).split(" ")[0] ?? "";
  const lines = loaded.state === "loaded" ? loaded.value.lines : [];
  const total = lines.reduce((sum, line) => sum + (line.amount ?? 0), 0);
  return (
    <section className={styles.section} aria-labelledby="me-incentives">
      <SectionHead id="me-incentives" title={copy.title(month)} end={copy.upTo(dayMonth(today))} />
      {loaded.state === "failed" && <p className={styles.quiet}>{copy.failed}</p>}
      {loaded.state === "loaded" && lines.length === 0 && <p className={styles.quiet}>{copy.none}</p>}
      {lines.length > 0 && (
        <>
          <p className={styles.total}>{rupees(total)}</p>
          <dl className={styles.lines}>
            {lines.map((line) => (
              <Line
                key={`${line.kind}/${line.city ?? ""}/${String(line.rate)}`}
                term={copy.line(monthCopy.kinds[line.kind], line.visits, line.rate === null ? null : rupees(line.rate))}
                value={line.amount === null ? copy.noRate : rupees(line.amount)}
              />
            ))}
          </dl>
        </>
      )}
    </section>
  );
}
