// A job's screen in the new look (docs/decisions/0243-job-and-the-door.md): a head with the way back, whose screen it
// is and the line beneath, a body that scrolls, and the bar at the foot holding the screen's actions, with the line
// that says what one still waits on.

import { ICONS } from "@maneman/brand/icons";
import { ActionBar } from "@maneman/ui/ActionBar";
import { IconButton } from "@maneman/ui/IconButton";
import { shortDate } from "@maneman/web-kit/dates";
import type { ReactNode } from "react";
import type { Job } from "../api.ts";
import { badgesLower, job as copy } from "../content.ts";
import { kindName, kindNameLower } from "../lib/kind.ts";
import { useScreen } from "../lib/useScreen.ts";
import { arrival, dayAfter, todayInIndia } from "../lib/when.ts";
import { go } from "../route.ts";
import { Safety } from "./Safety.tsx";
import styles from "./card-frame.module.css";

/** The day, written only when it is not today: "Tomorrow", or "Fri 27 Sep". */
function dayOf(date: string): string | null {
  const today = todayInIndia();
  if (date === today) return null;
  if (date === dayAfter(today)) return copy.tomorrow;
  return shortDate(date);
}

/** "9:30–10 am · service visit · prepaid", the line beneath the name, with the day first when it is not today. */
export function whenOf(job: Job): string {
  const parts = [dayOf(job.date), arrival(job), kindNameLower(job), badgesLower[job.badge]];
  return copy.when(parts.filter((part): part is string => part !== null));
}

/** The client's name, or the visit's kind where the API withholds the client until the day before. */
export const nameOf = (job: Job): string => job.client?.name ?? kindName(job);

export function CardFrame({
  title,
  sub,
  back = "/",
  foot,
  helper,
  safety,
  children,
}: {
  readonly title: string;
  readonly sub: string;
  /** Where the way back goes: Today, unless the screen opened from the job's. */
  readonly back?: string;
  /** The bar's actions, given the helper line's id for each it describes; null for a screen with none. */
  readonly foot: ReactNode | ((helperId: string | undefined) => ReactNode);
  /** What an action still waits on, above it. */
  readonly helper?: ReactNode;
  /** On a visit's screen, the visit: the shield in the header opens Safety (./Safety.tsx). */
  readonly safety?: string;
  readonly children: ReactNode;
}) {
  const heading = useScreen(title);
  return (
    <main className={styles.screen} data-look="light">
      <header className={styles.head}>
        <IconButton
          className={styles.back}
          d={ICONS.back}
          size="lg"
          label={copy.back}
          onClick={() => {
            go(back);
          }}
        />
        <div className={styles.who}>
          <h1 className={styles.name} ref={heading} tabIndex={-1}>
            {title}
          </h1>
          <p className={styles.when}>{sub}</p>
        </div>
        {safety !== undefined && <Safety jobId={safety} className={styles.safety} />}
      </header>
      <div className={styles.body}>{children}</div>
      {foot !== null && <ActionBar helper={helper}>{foot}</ActionBar>}
    </main>
  );
}
