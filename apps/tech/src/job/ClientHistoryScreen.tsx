// The client's history (docs/prompts/tech-redesign.md, "Client history"; docs/decisions/0242-client-record.md), as the
// prototype draws it: the client's name with their visits counted beneath, their alerts in the error's red under a
// head of their own, then every visit closed before this job, newest first, each its kind with its date at the end, who
// did it and how it closed, the note left for the next, its after photographs as labelled tiles, what was used and the
// piece fitted. The photographs are the API's to give, never kept on the phone.

import { SectionHead } from "@maneman/ui/SectionHead";
import { useAsync, valueOr } from "@maneman/ui/useAsync";
import { useLoad } from "@maneman/ui/useLoad";
import { useCallback } from "react";
import { api } from "../api.ts";
import type { components } from "../api-schema.ts";
import { clientRecord as copy } from "../content.ts";
import { CardFrame } from "../frame/CardFrame.tsx";
import { Failed, Loading } from "../frame/States.tsx";
import { sayKnown } from "../lang/index.ts";
import { kindName } from "../lib/kind.ts";
import { dayMonth } from "../lib/when.ts";
import { keptJob } from "../store/jobs.ts";
import { visitsOf } from "./ClientRecord.tsx";
import { PhotoTiles } from "./PhotoTiles.tsx";
import styles from "./client-history.module.css";

type Visit = components["schemas"]["TechnicianHistoryVisit"];

/** How a visit closed, in a word. */
const resultOf = (result: string | null): string =>
  result === "done" || result === "partial" || result === "no_show" ? copy.results[result] : copy.results.other;

function VisitEntry({ visit }: { visit: Visit }) {
  const used = visit.consumables.map((each) => `${sayKnown(each.name)} × ${String(each.quantity)}`).join(" · ");
  return (
    <li className={styles.visit}>
      <div className={styles.visitTop}>
        <h3 className={styles.kind}>{kindName({ type: visit.type, one_visit: false })}</h3>
        <span className={styles.date}>{dayMonth(visit.date)}</span>
      </div>
      <p className={styles.meta}>{copy.byAndResult(visit.technician, resultOf(visit.result))}</p>
      {visit.note !== null && <p className={styles.note}>{visit.note}</p>}
      {visit.photos.length > 0 && <PhotoTiles photos={visit.photos} alt={copy.photo} />}
      {used !== "" && <p className={styles.detail}>{used}</p>}
      {visit.piece !== null && <p className={styles.detail}>{copy.piece(visit.piece)}</p>}
    </li>
  );
}

export function ClientHistoryScreen({ id }: { id: string }) {
  const read = useCallback(() => api.clientHistory(id), [id]);
  const [loaded, retry] = useLoad(read);
  // Whose history, and how many visits since when, from the job's card the phone keeps.
  const readCard = useCallback(async () => (await keptJob(id)) ?? null, [id]);
  const card = valueOr(useAsync(readCard)[0], null);
  const sub = card === null ? null : visitsOf(card);
  return (
    <CardFrame
      title={card?.client?.name ?? copy.title}
      {...(sub === null ? {} : { sub })}
      back={`/jobs/${id}`}
      foot={null}
    >
      <div className={styles.page}>
        {loaded.state === "loading" && <Loading onPaper />}
        {loaded.state === "failed" && (
          <Failed message={copy.failed} retry={copy.retry} onRetry={retry} requestId={loaded.requestId} onPaper />
        )}
        {loaded.state === "loaded" && (
          <>
            {loaded.value.alerts.length > 0 && (
              <section className={styles.section} aria-labelledby="history-alerts">
                <SectionHead id="history-alerts" title={copy.clientAlerts} size="list" />
                {loaded.value.alerts.map((alert) => (
                  <p key={alert.id} className={styles.alert}>
                    {alert.body}
                  </p>
                ))}
              </section>
            )}
            <section className={styles.section} aria-labelledby="history-visits">
              <SectionHead id="history-visits" title={copy.visits} size="list" />
              {loaded.value.visits.length === 0 ? (
                <p className={styles.none}>{copy.none}</p>
              ) : (
                <ul className={styles.visits}>
                  {loaded.value.visits.map((visit) => (
                    <VisitEntry key={visit.id} visit={visit} />
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </CardFrame>
  );
}
