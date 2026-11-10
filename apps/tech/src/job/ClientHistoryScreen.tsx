// The client's history (docs/prompts/tech-redesign.md, "Client history"; docs/decisions/0242-client-record.md), in the
// new look: their alerts at the top, then every visit closed before this job, newest first, each with who did it and
// how it closed, the note left for the next, its after photographs, what was used and the piece fitted. The
// photographs are the API's to give, never kept on the phone.

import { ICONS } from "@maneman/brand/icons";
import { IconButton } from "@maneman/ui/IconButton";
import { ProblemCard } from "@maneman/ui/ProblemCard";
import { SectionHead } from "@maneman/ui/SectionHead";
import { useLoad } from "@maneman/ui/useLoad";
import { useCallback } from "react";
import { api } from "../api.ts";
import type { components } from "../api-schema.ts";
import { clientRecord as copy } from "../content.ts";
import { Failed, Loading } from "../frame/States.tsx";
import { kindName } from "../lib/kind.ts";
import { dayMonth } from "../lib/when.ts";
import { useScreen } from "../lib/useScreen.ts";
import { go } from "../route.ts";
import styles from "./client-history.module.css";

type Visit = components["schemas"]["TechnicianHistoryVisit"];

/** How a visit closed, in a word. */
const resultOf = (result: string | null): string =>
  result === "done" || result === "partial" || result === "no_show" ? copy.results[result] : copy.results.other;

function VisitEntry({ visit }: { visit: Visit }) {
  const kind = kindName({ type: visit.type, one_visit: false });
  return (
    <li className={styles.visit}>
      <SectionHead title={copy.visit(kind, dayMonth(visit.date))} size="list" ruled={false} />
      <p className={styles.meta}>{copy.byAndResult(visit.technician, resultOf(visit.result))}</p>
      {visit.note !== null && <p className={styles.note}>{visit.note}</p>}
      {visit.photos.length > 0 && (
        <div className={styles.photos}>
          {visit.photos.map((photo) => (
            <img key={photo.url} className={styles.photo} src={photo.url} alt={copy.photo(photo.angle)} />
          ))}
        </div>
      )}
      {visit.consumables.length > 0 && (
        <p className={styles.detail}>
          {copy.used}: {visit.consumables.map((each) => `${each.name} × ${String(each.quantity)}`).join(", ")}
        </p>
      )}
      {visit.piece !== null && <p className={styles.detail}>{copy.piece(visit.piece)}</p>}
    </li>
  );
}

export function ClientHistoryScreen({ id }: { id: string }) {
  const heading = useScreen(copy.title);
  const read = useCallback(() => api.clientHistory(id), [id]);
  const [loaded, retry] = useLoad(read);
  return (
    <main className={styles.screen} data-look="light">
      <header className={styles.head}>
        <IconButton
          d={ICONS.back}
          size="lg"
          label={copy.back}
          onClick={() => {
            go(`/jobs/${id}`);
          }}
        />
        <h1 className={styles.title} ref={heading} tabIndex={-1}>
          {copy.title}
        </h1>
      </header>
      {loaded.state === "loading" && <Loading onPaper />}
      {loaded.state === "failed" && (
        <Failed message={copy.failed} retry={copy.retry} onRetry={retry} requestId={loaded.requestId} onPaper />
      )}
      {loaded.state === "loaded" && (
        <>
          {loaded.value.alerts.length > 0 && (
            <ProblemCard className={styles.alerts} title={copy.alerts}>
              <ul className={styles.alertList}>
                {loaded.value.alerts.map((alert) => (
                  <li key={alert.id}>{alert.body}</li>
                ))}
              </ul>
            </ProblemCard>
          )}
          {loaded.value.visits.length === 0 ? (
            <p className={styles.none}>{copy.none}</p>
          ) : (
            <ul className={styles.visits}>
              {loaded.value.visits.map((visit) => (
                <VisitEntry key={visit.id} visit={visit} />
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
