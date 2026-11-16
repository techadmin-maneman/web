// Home's notes beneath its card: a visit nobody was home for while ops decide it, and a one visit's payment while the
// client owes it; and when the free service visits they hold must be used by.

import { TextLink } from "@maneman/ui/TextLink";
import { capsLook } from "@maneman/ui/Caps";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { apiNow } from "@maneman/web-kit/clock";
import { indiaDate, listDate, shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { firstNameOf } from "@rules/lib/names.ts";
import type { Me } from "../api.ts";
import { home } from "../content.ts";
import styles from "./home.module.css";

/** A visit nobody was home for, while ops decide what follows: said here, so the client is not left with silence. */
export function Missed({ missed }: { missed: NonNullable<Me["missed_visit"]> }) {
  const copy = home.missed;
  return (
    <section className={styles.prompt} aria-labelledby="missed">
      <h2 className={capsLook(styles.label)} id="missed">
        {copy.label}
      </h2>
      <p className={styles.owedLine}>
        {copy.line(shortDate(missed.date), missed.technician === null ? null : firstNameOf(missed.technician))}
      </p>
      <p className={styles.owedWait}>{copy.next}</p>
    </section>
  );
}

/** A one visit the client was fitted at and has not paid for: what for, how much, and the link to pay by. */
export function PaymentOwed({ owed }: { owed: NonNullable<Me["payment_owed"]> }) {
  const copy = home.owed;
  return (
    <section className={styles.prompt} aria-labelledby="owed">
      <h2 className={capsLook(styles.label)} id="owed">
        {copy.label}
      </h2>
      <p className={styles.owedLine}>{copy.line(owed.product, rupees(owed.amount))}</p>
      {owed.url === null ? (
        <p className={styles.owedWait}>{copy.onItsWay}</p>
      ) : (
        <TextLink tone="brass" className={styles.promptLink} href={owed.url} newTab>
          <span>{copy.pay}</span>
          <VisuallyHidden>{`, ${copy.newTab}`}</VisuallyHidden>
        </TextLink>
      )}
    </section>
  );
}

/** "Use by 2 Oct", "Use by tonight" on the day, or "1 to use by 2 Oct" where only some of them end first. */
export function expiryLine(credits: NonNullable<Me["credits"]>, expiry: string): string {
  const today = indiaDate(new Date(apiNow()).toISOString());
  const lastDay = indiaDate(expiry);
  const when = lastDay === today ? home.credits.tonight : listDate(lastDay, Number(today.slice(0, 4)));
  // False for a Home the phone kept from an earlier release, which does not say how many end first.
  const someEndFirst = credits.expiring_visits < credits.visits;
  return someEndFirst ? home.credits.someUseBy(credits.expiring_visits, when) : home.credits.useBy(when);
}
