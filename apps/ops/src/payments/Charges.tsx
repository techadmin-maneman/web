// The charges of a day, beneath its figures on Charges (./NoShowsScreen.tsx): each late cancellation and no-show, by
// who and what it kept, and the line of evidence beneath.

import { EmptyState } from "@maneman/ui/EmptyState";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import type { Charge } from "../api.ts";
import { firstShown, noShows } from "../content.ts";
import styles from "./no-shows.module.css";

/** The charge's first line: the client, then what it was. */
function whoOf(charge: Charge): string {
  const copy = noShows.money.charges;
  const name = charge.person?.name ?? copy.unknown;
  if (charge.kind === "no_show") return copy.noShow(name);
  return charge.change === "moved" ? copy.moved(name) : copy.cancelled(name);
}

/** A late change's two times, each with its day where the change came on a day before the visit. */
function changedOf(at: string, visit: string | null): string {
  const copy = noShows.money.charges;
  if (visit === null) return copy.changed(indiaClock(at), copy.undated);
  const sameDay = indiaDate(at) === indiaDate(visit);
  const when = (instant: string) =>
    sameDay ? indiaClock(instant) : `${shortDate(indiaDate(instant))}, ${indiaClock(instant)}`;
  return copy.changed(when(at), when(visit));
}

/** The line of evidence beneath it, in the board's own words. */
function evidenceOf(charge: Charge): string {
  const copy = noShows.money.charges;
  if (charge.kind !== "no_show") return changedOf(charge.at, charge.visit_started_at);
  const was = charge.visit_started_at === null ? copy.undated : indiaClock(charge.visit_started_at);
  return charge.technician === null ? copy.unattended(was) : copy.attended(charge.technician, was);
}

export function Charges({ charges, today, more }: { charges: readonly Charge[]; today: boolean; more: boolean }) {
  const copy = noShows.money.charges;
  if (charges.length === 0) return <EmptyState look="panel" line={copy.empty(today)} />;

  return (
    <>
      <ul className={styles.charges}>
        {charges.map((charge) => (
          <li className={styles.chargeRow} key={charge.id}>
            <div className={styles.chargeLine}>
              <span className={styles.who}>{whoOf(charge)}</span>
              {/* A no-show charged before a charge recorded what it kept carries no amount. */}
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
      {more && (
        <InlineMessage tone="note" className={styles.first}>
          {firstShown(charges.length)}
        </InlineMessage>
      )}
    </>
  );
}
