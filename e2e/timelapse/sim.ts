// The timelapse's one clock. Day 1 is Monday 2 November 2026 in India; day 180 is Friday 30 April 2027, the last day
// of month six. Moving it moves the API (PUT /api/dev/clock, src/routes/dev-clock.ts), the cron (a run in every day
// crossed, at the hour each slot's jobs are due by), and every browser's clock (Playwright's clock, installed on each
// context), so nothing ever waits on a real hour.

import type { BrowserContext } from "@playwright/test";
import { API } from "./stack.ts";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY_MS = 24 * HOUR;
const INDIA = 330 * MINUTE;

export const FIRST_DAY = "2026-11-02";
export const LAST_DAY_NUMBER = 180;
const START = Date.parse(`${FIRST_DAY}T00:00:00+05:30`);

/** India's date of sim day `day`, from 1. */
export const dateOf = (day: number): string => new Date(START + (day - 1) * DAY_MS + INDIA).toISOString().slice(0, 10);

/** The sim day an instant falls on in India. */
export const dayOf = (at: number): number => Math.floor((at - START) / DAY_MS) + 1;

/** An instant on sim day `day` at India's `hhmm`. */
export const at = (day: number, hhmm: string): number => Date.parse(`${dateOf(day)}T${hhmm}:00+05:30`);

/** 0 for Sunday. */
export const weekdayOf = (day: number): number => new Date(Date.parse(`${dateOf(day)}T12:00:00Z`)).getUTCDay();

/** The sim's month, 1 to 6: November is 1. */
export const monthOf = (day: number): number => {
  const [year = 0, month = 0] = dateOf(day).split("-").map(Number);
  return (year - 2026) * 12 + month - 10;
};

export const isMonthEnd = (day: number): boolean => monthOf(day + 1) !== monthOf(day);

/** "Day 45, 14:30" for an instant. */
export function label(instant: number): string {
  const india = new Date(instant + INDIA).toISOString();
  return `Day ${String(dayOf(instant))}, ${india.slice(11, 16)}`;
}

/** India's "YYYY-MM-DD" for an instant. */
export const indiaDateOf = (instant: number): string => new Date(instant + INDIA).toISOString().slice(0, 10);

/** Longer than any cron run takes: Cloudflare cuts one off at fifteen minutes, a local one at much less. */
const TICK_TIMEOUT_MS = 90_000;

/** The minutes of the hour the nightly copy and the weekly backup are due in (src/scheduled/cron.ts). */
const ANALYTICS_MINUTE = 31;
const BACKUP_MINUTE = 33;

/** What the clock's own work cost, for the run's summary. */
export const clockCost = { sets: 0, setMs: 0, workflowWaitMs: 0, workflowsUnfinished: [] as string[] };

/**
 * Waits, five seconds at most, for tonight's own Workflows (the nightly copy, and Sunday's backup) to finish. Only
 * tonight's: an instance left running from an earlier night is a finding of its own, not a reason to wait.
 */
async function waitForWorkflows(date: string, sunday: boolean): Promise<void> {
  const started = Date.now();
  const wanted = [
    `mm-analytics-copy-local/instances/copy-${date}`,
    ...(sunday ? [`mm-backup-local/instances/backup-${date}`] : []),
  ];
  for (const path of wanted) {
    for (;;) {
      const status = await fetch(`${API}/cdn-cgi/local/explorer/api/workflows/${path}`).then(
        async (answer) =>
          answer.ok ? ((await answer.json()) as { result?: { status?: string } }).result?.status : "none",
        () => "none",
      );
      if (status !== "running" && status !== "queued") break;
      if (Date.now() - started > 5_000) {
        clockCost.workflowsUnfinished.push(`${path}: ${status}`);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  clockCost.workflowWaitMs += Date.now() - started;
}

/** The hour of India's day the end-of-day run goes in: after every daily slot (the latest is 23:00). */
const NIGHT_RUN = "23:40";

export interface TickResult {
  readonly at: number;
  readonly ms: number;
  readonly status: number;
}

/** How far ahead of the real clock the sim is, as each request tells the API (src/lib/dev-clock.ts). */
let ahead = 0;
export const clockHeaders = (): Record<string, string> => ({ "X-Dev-Clock-Ahead": String(ahead) });

/** Now on the sim's clock, for what the run stamps itself, as Razorpay stamps a payment. */
export const simNow = (): number => Date.now() + ahead;

export class SimClock {
  private instant = START;
  private readonly contexts = new Set<BrowserContext>();
  /** The last day whose end-of-day run has gone. */
  private closedDay = 0;
  readonly ticks: TickResult[] = [];
  /** Told of each cron run, so the run's log lines are read for failures. */
  onTick: (tick: TickResult) => Promise<void> = () => Promise.resolve();

  get now(): number {
    return this.instant;
  }

  get day(): number {
    return dayOf(this.instant);
  }

  /** Every context, on the sim's clock or not: each tells the API the sim's time with every request. */
  private readonly told = new Set<BrowserContext>();

  /** Puts a context on the sim's clock from now on. */
  async adopt(context: BrowserContext): Promise<void> {
    this.contexts.add(context);
    await context.clock.install({ time: this.instant });
    context.on("close", () => this.contexts.delete(context));
  }

  /** Headers of a context's own that every clock move keeps, beside the clock's. */
  private readonly own = new Map<BrowserContext, Record<string, string>>();

  /** Has a context's requests carry the sim's time to the API, whatever its own clock says, and `extra` too. */
  async tell(context: BrowserContext, extra: Record<string, string> = {}): Promise<void> {
    this.told.add(context);
    this.own.set(context, extra);
    context.on("close", () => {
      this.told.delete(context);
      this.own.delete(context);
    });
    await context.setExtraHTTPHeaders({ ...clockHeaders(), ...extra });
  }

  /** Lets a context go off the sim's clock: its pages keep their own, as a phone set wrong would. */
  release(context: BrowserContext): void {
    this.contexts.delete(context);
  }

  /** Sets every clock to `instant`, crossing nothing: no cron run goes. */
  async set(instant: number): Promise<void> {
    const started = Date.now();
    this.instant = instant;
    ahead = instant - Date.now();
    const answer = await fetch(`${API}/api/dev/clock`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ at: new Date(instant).toISOString() }),
    });
    if (!answer.ok) throw new Error(`the API's clock would not move (${String(answer.status)})`);
    await Promise.all([...this.contexts].map((context) => context.clock.setSystemTime(instant)));
    await Promise.all(
      [...this.told].map((context) => context.setExtraHTTPHeaders({ ...clockHeaders(), ...this.own.get(context) })),
    );
    clockCost.sets += 1;
    clockCost.setMs += Date.now() - started;
  }

  /**
   * One cron run now. With no minute, every job (npm run tick's way: a five-minute cron runs them all); with one, the
   * jobs due in that minute of the hour alone, as the every-minute trigger runs them (src/scheduled/schedule.ts).
   */
  async tick(minute?: number): Promise<TickResult> {
    const started = Date.now();
    const path =
      minute === undefined
        ? `/__scheduled?cron=${encodeURIComponent("*/5 * * * *")}`
        : `/cdn-cgi/handler/scheduled?cron=${encodeURIComponent("* * * * *")}&time=${String(Date.UTC(2026, 0, 1, 0, minute))}`;
    // A run that never answers is a finding, not the end of the timelapse.
    // The run's clock again first: the cron runs on the isolate's, which a reload may have put back.
    await this.set(this.instant);
    const status = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(TICK_TIMEOUT_MS) }).then(
      async (answer) => {
        await answer.text();
        return answer.status;
      },
      () => 0,
    );
    const result = { at: this.instant, ms: Date.now() - started, status };
    this.ticks.push(result);
    await this.onTick(result);
    return result;
  }

  /**
   * The minute after the night's run, as the every-minute trigger would: the jobs whose work goes on in a Workflow
   * look again once it has finished, and so record the night as run well.
   */
  private async followWorkflows(day: number): Promise<void> {
    await waitForWorkflows(indiaDateOf(this.instant), weekdayOf(day) === 0);
    await this.set(this.instant + 5 * MINUTE);
    await this.tick(ANALYTICS_MINUTE);
    if (weekdayOf(day) === 0) await this.tick(BACKUP_MINUTE);
  }

  /**
   * Moves every clock forward to `instant`, running the cron at the night hour of each day crossed, so each day's
   * slotted jobs run in their day, in order.
   */
  async advanceTo(instant: number): Promise<void> {
    if (instant < this.instant) throw new Error(`the sim's clock only goes forward (${label(instant)})`);
    for (let day = Math.max(this.closedDay + 1, this.day); ; day += 1) {
      const night = at(day, NIGHT_RUN);
      if (night > instant) break;
      if (night >= this.instant) {
        await this.set(night);
        await this.tick();
        await this.followWorkflows(day);
      }
      this.closedDay = day;
    }
    await this.set(instant);
  }

  /** Moves the clocks on by `ms`, with any night runs crossed. */
  async pass(ms: number): Promise<void> {
    await this.advanceTo(this.instant + ms);
  }
}
