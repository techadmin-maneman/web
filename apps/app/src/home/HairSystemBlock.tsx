// Home's hair system (design/client-redesign, Home): the one worn now, which of its months it is in, and when its
// replacement may be booked (docs/decisions/0253-replacement-when-due-and-change-of-hair-system.md). Its history is a
// page of its own.

import { ProgressLine } from "@maneman/ui/Progress";
import { textLinkLook } from "@maneman/ui/TextLink";
import { apiNow } from "@maneman/web-kit/clock";
import { dayMonth, fullDate, todayInIndia } from "@maneman/web-kit/dates";
import type { Me } from "../api.ts";
import { home } from "../content.ts";
import { AppLink } from "../frame/Shell.tsx";
import styles from "./hair-system-block.module.css";

/** The month of its life a hair system is in, from 1, counted from the day it was fitted. */
export function monthWorn(fittedOn: string, today: string): number {
  const part = (date: string, from: number, to: number) => Number(date.slice(from, to));
  const months =
    (part(today, 0, 4) - part(fittedOn, 0, 4)) * 12 +
    (part(today, 5, 7) - part(fittedOn, 5, 7)) -
    (part(today, 8, 10) < part(fittedOn, 8, 10) ? 1 : 0);
  return Math.max(1, months + 1);
}

/** Booked, open to book now, or the day it opens on. */
function lineOf(me: Me, worn: NonNullable<Me["hair_system"]>): string {
  const copy = home.hairSystem;
  if (me.next_visit?.type === "replacement") return copy.booked(dayMonth(me.next_visit.date));
  if (me.booking.types.includes("replacement")) return copy.bookNow(dayMonth(worn.due_on));
  return copy.bookFrom(fullDate(worn.fitted_on), dayMonth(worn.replacement_opens_on));
}

export function HairSystemBlock({ me }: { me: Me }) {
  const worn = me.hair_system;
  if (worn === null) return null;
  const copy = home.hairSystem;
  const of = worn.replace_after_months;
  const month = Math.min(of, monthWorn(worn.fitted_on, todayInIndia(apiNow())));
  return (
    <section aria-labelledby="hair-system">
      <div className={styles.head}>
        <h2 className={styles.title} id="hair-system">
          {copy.title}
        </h2>
        <AppLink className={textLinkLook({ className: styles.history })} to="/hair-system">
          {copy.history}
        </AppLink>
      </div>
      <div className={styles.body}>
        <p className={styles.worn}>
          <strong>{worn.name}</strong>
          <span className={styles.month}>{copy.month(month, of)}</span>
        </p>
        <ProgressLine className={styles.age} value={month / of} tone="accent" />
        <p className={styles.line}>{lineOf(me, worn)}</p>
      </div>
    </section>
  );
}
