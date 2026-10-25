// The technician's own month: the visits they closed in it, by kind, and what they earned at their rates, as payroll
// reads it (src/routes/tech/month.ts). Their own figures alone; a kind with no rate set says so rather than a nought.

import { ICONS } from "@maneman/brand/icons";
import { IconButton } from "@maneman/ui/IconButton";
import { useLoad } from "@maneman/ui/useLoad";
import { rupees } from "@maneman/web-kit/money";
import { api } from "../api.ts";
import { month as copy } from "../content.ts";
import { useScreen } from "../lib/useScreen.ts";
import { go } from "../route.ts";
import { Failed, Loading } from "../states/States.tsx";
import frame from "../components/frame.module.css";
import styles from "./mine.module.css";

export function MonthScreen() {
  const heading = useScreen(copy.title);
  const [loaded, retry] = useLoad(api.month);
  const lines = loaded.state === "loaded" ? loaded.value.lines : [];
  const total = lines.reduce((sum, line) => sum + (line.amount ?? 0), 0);
  return (
    <main className={styles.screen}>
      <header className={frame.head}>
        <IconButton
          className={styles.back}
          d={ICONS.back}
          size="lg"
          weight="heavy"
          label={copy.back}
          onClick={() => {
            go("/");
          }}
        />
        <h1 className={styles.title} ref={heading} tabIndex={-1}>
          {copy.title}
        </h1>
      </header>
      {loaded.state === "loading" && <Loading />}
      {loaded.state === "failed" && (
        <Failed message={copy.failed} retry={copy.retry} onRetry={retry} requestId={loaded.requestId} />
      )}
      {loaded.state === "loaded" && (
        <section className={styles.section}>
          {lines.length === 0 ? (
            <p className={styles.quiet}>{copy.none}</p>
          ) : (
            <dl className={styles.figures}>
              {lines.map((line) => (
                <div key={`${line.kind}/${line.city ?? ""}/${String(line.rate)}`} className={styles.figure}>
                  <dt>{copy.line(copy.kinds[line.kind], line.visits)}</dt>
                  <dd>{line.amount === null ? copy.noRate : rupees(line.amount)}</dd>
                </div>
              ))}
              <div className={styles.figure}>
                <dt>{copy.total}</dt>
                <dd>{rupees(total)}</dd>
              </div>
            </dl>
          )}
        </section>
      )}
    </main>
  );
}
