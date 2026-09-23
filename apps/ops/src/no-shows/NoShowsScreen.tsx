// No-shows (Ops Console, board D1): each case with the three facts ops rule
// on, charged or waived here. The board draws this queue beneath the day's
// money and beside a disputed charge; neither has a route, so neither is built
// (docs/open-points.md, item 55).
//
// Nothing here takes money. The server never charges by itself, and this
// records ops' ruling under whoever Access says is signed in
// (src/policy/no-show.ts, docs/decisions/0031-access-and-audit.md).

import { indiaClock, shortDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { api, type NoShowCase } from "../api.ts";
import { Shell } from "../components/Shell.tsx";
import { noShows } from "../content.ts";
import { useLoad } from "../lib/useLoad.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "./no-shows.module.css";

type Choice = "charged" | "waived";

/** Where a case is in its decision: waiting, sending, or refused by the API. */
type Decision =
  { readonly step: "open" } | { readonly step: "sending" } | { readonly step: "failed"; readonly code: string };

/** How long the technician waited, from the two instants the route gives. */
function waitedMinutes(waitEndsAt: string, checkedInAt: string): number {
  return Math.round((Date.parse(waitEndsAt) - Date.parse(checkedInAt)) / 60_000);
}

function Facts({ each }: { each: NoShowCase }) {
  const copy = noShows.queue;
  const rows = [
    [copy.facts.checkIn, indiaClock(each.checked_in_at)],
    [copy.facts.distance, copy.distance(each.distance_m)],
    [
      copy.facts.whatsapp,
      each.message_delivered_at === null ? copy.notDelivered : copy.delivered(indiaClock(each.message_delivered_at)),
    ],
    [
      copy.facts.waited,
      copy.waited(
        waitedMinutes(each.wait_ends_at, each.checked_in_at),
        each.closed_at === null ? null : indiaClock(each.closed_at),
      ),
    ],
  ] as const;

  return (
    <dl className={styles.facts}>
      {rows.map(([name, value]) => (
        <div className={styles.fact} key={name}>
          <dt className={styles.factName}>{name}</dt>
          <dd className={styles.factValue}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Case({ each, onDecided }: { each: NoShowCase; onDecided: () => void }) {
  const [decision, setDecision] = useState<Decision>({ step: "open" });
  const copy = noShows.queue;

  const decide = async (choice: Choice) => {
    setDecision({ step: "sending" });
    const answer = await api.decideNoShow(each.id, choice);
    if (answer.ok) onDecided();
    else setDecision({ step: "failed", code: answer.code });
  };

  const sending = decision.step === "sending";
  return (
    <li className={styles.case}>
      <div className={styles.caseHead}>
        <span className={styles.visit}>
          {each.visit_date === null ? copy.undated : copy.visit(shortDate(each.visit_date))}
        </span>
        {each.technician !== null && <span className={styles.technician}>{copy.attended(each.technician)}</span>}
      </div>
      <Facts each={each} />
      <div className={styles.actions}>
        <button className={styles.charge} type="button" disabled={sending} onClick={() => void decide("charged")}>
          {sending ? copy.deciding : copy.charge}
        </button>
        <button className={styles.waive} type="button" disabled={sending} onClick={() => void decide("waived")}>
          {copy.waive}
        </button>
      </div>
      {decision.step === "failed" && (
        <p className={styles.error} role="alert">
          {copy.errors[decision.code] ?? copy.errors.unknown}
        </p>
      )}
    </li>
  );
}

function Queue() {
  const [loaded, retry] = useLoad(api.noShows);
  // A ruled case leaves the queue at once; the count follows it.
  const [ruled, setRuled] = useState<readonly string[]>([]);
  const copy = noShows.queue;

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} />;

  const waiting = loaded.value.cases.filter((each) => !ruled.includes(each.id));
  return (
    <section className={styles.panel} aria-labelledby="no-shows">
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle} id="no-shows">
          {copy.title}
        </h2>
        <span className={styles.count}>{waiting.length}</span>
      </div>
      {waiting.length === 0 ? (
        <p className={styles.empty}>{copy.empty}</p>
      ) : (
        <ul className={styles.cases}>
          {waiting.map((each) => (
            <Case
              key={each.id}
              each={each}
              onDecided={() => {
                setRuled((already) => [...already, each.id]);
              }}
            />
          ))}
        </ul>
      )}
      <p className={styles.note}>{copy.note}</p>
    </section>
  );
}

export function NoShowsScreen() {
  return (
    <Shell section="/no-shows" title={noShows.title}>
      <div className={styles.column}>
        <Queue />
      </div>
    </Shell>
  );
}
