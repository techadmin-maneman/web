// No-shows (Ops Console, board D1): the day's money over the charges it was
// kept on, then each case with the three facts ops rule on, charged or waived
// here. The board's second card is a disputed charge; nothing records a dispute
// and no client can raise one, so it is a line between the two and not a card
// (docs/open-points.md, item 57).
//
// Nothing here takes money. The server never charges by itself, and this
// records ops' ruling under whoever Access says is signed in
// (src/policy/no-show.ts, docs/decisions/0031-access-and-audit.md).

import { indiaClock, shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { type ReactNode, useState } from "react";
import { api, type Charge, type NoShowCase } from "../api.ts";
import { Shell } from "../components/Shell.tsx";
import { noShows } from "../content.ts";
import { useLoad } from "../lib/useLoad.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "./no-shows.module.css";

type Choice = "charged" | "waived";

/** The charge's first line: the client, then what it was. */
function whoOf(charge: Charge): string {
  const copy = noShows.money.charges;
  const name = charge.person?.name ?? copy.unknown;
  if (charge.kind === "no_show") return copy.noShow(name);
  return charge.change === "moved" ? copy.moved(name) : copy.cancelled(name);
}

/** The line of evidence beneath it, in the board's own words. */
function evidenceOf(charge: Charge): string {
  const copy = noShows.money.charges;
  const was = charge.visit_started_at === null ? copy.undated : indiaClock(charge.visit_started_at);
  if (charge.kind !== "no_show") return copy.changed(indiaClock(charge.at), was);
  return charge.technician === null ? copy.unattended(was) : copy.attended(charge.technician, was);
}

function Charges({ charges }: { charges: readonly Charge[] }) {
  const copy = noShows.money.charges;
  if (charges.length === 0) return <p className={styles.empty}>{copy.empty}</p>;

  return (
    <ul className={styles.charges}>
      {charges.map((charge) => (
        <li className={styles.chargeRow} key={charge.id}>
          <div className={styles.chargeLine}>
            <span className={styles.who}>{whoOf(charge)}</span>
            {/* A no-show carries no amount: ops rule on the evidence, and P2-M5 applies the charge. */}
            {charge.amount === null ? (
              <span className={styles.unrecorded}>{copy.noAmount}</span>
            ) : (
              <span className={styles.chargeAmount}>{rupees(charge.amount)}</span>
            )}
          </div>
          <p className={styles.evidence}>{evidenceOf(charge)}</p>
        </li>
      ))}
    </ul>
  );
}

function Money() {
  const [loaded, retry] = useLoad(api.dayMoney);
  const copy = noShows.money;

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} />;

  const day = loaded.value;
  return (
    <section className={styles.panel} aria-labelledby="day-money">
      <h2 className={styles.hiddenTitle} id="day-money">
        {copy.title}
      </h2>
      <dl className={styles.figures}>
        <div className={styles.figure}>
          <dt className={styles.figureName}>{copy.figures.collected}</dt>
          <dd className={styles.amount}>{rupees(day.collected)}</dd>
        </div>
        <div className={styles.figure}>
          <dt className={styles.figureName}>
            {copy.figures.processing}
            {day.refunded > 0 && <span className={styles.aside}>{copy.refunded(rupees(day.refunded))}</span>}
          </dt>
          <dd className={styles.amount}>{rupees(day.refunds_processing)}</dd>
        </div>
        <div className={styles.figure}>
          <dt className={styles.figureName}>
            {copy.figures.charged}
            {/*
             * Nothing records what a no-show was charged, so the figure holds
             * what was kept and says what it leaves out, rather than pricing a
             * no-show the system never priced (ADR 0036, PR #89).
             */}
            {day.no_shows_charged > 0 && <span className={styles.aside}>{copy.uncharged(day.no_shows_charged)}</span>}
          </dt>
          <dd className={styles.amount}>{rupees(day.charged)}</dd>
        </div>
      </dl>
      <h3 className={styles.chargesTitle}>{copy.charges.title}</h3>
      <Charges charges={day.charges} />
    </section>
  );
}

/** Where a case is in its decision: waiting, sending, or refused by the API. */
type Decision =
  { readonly step: "open" } | { readonly step: "sending" } | { readonly step: "failed"; readonly code: string };

/** How long the technician waited, from the two instants the route gives. */
function waitedMinutes(waitEndsAt: string, checkedInAt: string): number {
  return Math.round((Date.parse(waitEndsAt) - Date.parse(checkedInAt)) / 60_000);
}

function Facts({ each }: { each: NoShowCase }) {
  const copy = noShows.queue;
  const rows: readonly (readonly [string, ReactNode])[] = [
    [copy.facts.checkIn, indiaClock(each.checked_in_at)],
    [
      copy.facts.distance,
      // Never a number when none was measured: a missing distance is not 0 m,
      // and this fact helps decide whether to charge a client (ADR 0036).
      each.distance_m === null ? (
        <span className={styles.unmeasured}>{copy.unmeasured}</span>
      ) : (
        copy.distance(each.distance_m)
      ),
    ],
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
  ];

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
        <Money />
        {/* The board's second card is a disputed charge; the queue stands where it does. */}
        <p className={styles.caption}>{noShows.money.noDispute}</p>
        <Queue />
      </div>
    </Shell>
  );
}
