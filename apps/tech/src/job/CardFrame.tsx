// A job's screen (board A3): its head — back, the client, when and what, the
// badge — a body that scrolls, and the one action fixed at the foot, where a
// gloved thumb finds it on every screen.

import { ICONS } from "@maneman/brand/icons";
import { Icon } from "@maneman/ui/Icon";
import { shortDate } from "@maneman/web-kit/dates";
import type { ReactNode } from "react";
import type { Job } from "../api.ts";
import { badges, job as copy, types, typesLower } from "../content.ts";
import { STROKE } from "../icons.ts";
import { useScreen } from "../lib/useScreen.ts";
import { clock, dayAfter, todayInIndia } from "../lib/when.ts";
import { go } from "../route.ts";
import styles from "./job.module.css";

/** The day, written only when it is not today: "Tomorrow", or "Fri 27 Sep". */
function dayOf(date: string): string | null {
  const today = todayInIndia();
  if (date === today) return null;
  if (date === dayAfter(today)) return copy.tomorrow;
  return shortDate(date);
}

/** "Tomorrow · 10 am · service · 1 slot", as board A3 writes the line beneath the name. */
function whenOf(job: Job): string {
  const kind = job.type === null ? copy.locked.title : typesLower[job.type];
  const slots = job.slots === null ? null : copy.slots(job.slots);
  const parts = [dayOf(job.date), clock(job.starts_at), kind, slots];
  return copy.when(parts.filter((part): part is string => part !== null));
}

function nameOf(job: Job): string {
  if (job.client !== null) return job.client.name;
  return job.type === null ? copy.locked.title : types[job.type];
}

/** `foot` is the screen's one action, or null for a screen that has none. */
export function CardFrame({ job, foot, children }: { job: Job; foot: ReactNode; children: ReactNode }) {
  const heading = useScreen(nameOf(job));
  return (
    <main className={styles.screen}>
      <header className={styles.head}>
        <button
          className={styles.back}
          type="button"
          aria-label={copy.back}
          onClick={() => {
            go("/");
          }}
        >
          <Icon d={ICONS.back} size={24} stroke={STROKE} />
        </button>
        <div className={styles.headWho}>
          <h1 className={styles.name} ref={heading} tabIndex={-1}>
            {nameOf(job)}
          </h1>
          <p className={styles.when}>{whenOf(job)}</p>
        </div>
        <span className={styles.badge}>{badges[job.badge]}</span>
      </header>

      <div className={styles.body}>{children}</div>

      {foot !== null && <div className={styles.foot}>{foot}</div>}
    </main>
  );
}
