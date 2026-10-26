// Every workflow step the timelapse takes, and everything that went wrong in it, without stopping the run: a step
// that fails is written down with what the pages said (console errors, uncaught errors, answers of 400 and over,
// answers outside the API's contract), and, where later steps need what it should have made, healed another way.

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext, Page, Response } from "@playwright/test";
import { contractErrors, type Surface } from "../contract.ts";
import { label, type SimClock } from "./sim.ts";
import { OUT } from "./stack.ts";

export type AppName = "app" | "ops" | "tech" | "site" | "worker";

export interface StepMeta {
  /** The wave it belongs to, as "geography#2". */
  readonly wave: string;
  readonly workflow: string;
  readonly app: AppName;
  readonly screen: string;
  readonly action: string;
  /** "ui" when a person's clicks did it, "api" when the page's own API calls did and the screen was read after. */
  readonly mode?: "ui" | "api" | "ui+api";
  /** Answers of these statuses are the step's point, not a fault (a refusal it means to provoke). */
  readonly allow?: readonly number[];
}

export interface Problem {
  readonly kind: "assert" | "error" | "console" | "pageerror" | "http" | "contract" | "cron" | "worker";
  readonly message: string;
  readonly app?: AppName;
  readonly url?: string;
  readonly status?: number;
}

export interface StepRecord extends StepMeta {
  readonly id: number;
  readonly day: number;
  readonly sim: string;
  readonly simAt: string;
  status: "passed" | "failed" | "healed";
  ms: number;
  problems: Problem[];
  healed?: string;
  shot?: string;
}

const SURFACE: Readonly<Record<string, Surface>> = { app: "client", ops: "ops", tech: "tech", site: "public" };

/** Console lines that repeat what the answer's own record says, or that a browser prints for nothing we did. */
const NOISE = [/^Failed to load resource/, /favicon/, /Download the React DevTools/];

export class Steps {
  readonly records: StepRecord[] = [];
  private current: StepRecord | null = null;
  /** What the pages said between steps, kept for the step that follows. */
  private loose: Problem[] = [];
  private contractChecks: Promise<void>[] = [];
  private readonly file: string;
  private nextId = 1;

  private readonly clock: SimClock;

  constructor(clock: SimClock) {
    this.clock = clock;
    mkdirSync(join(OUT, "shots"), { recursive: true });
    this.file = join(OUT, "steps.jsonl");
  }

  private note(problem: Problem): void {
    if (this.current === null) this.loose.push(problem);
    else this.current.problems.push(problem);
  }

  /** Something the run itself saw, such as a cron job failing, for the step under way or the next. */
  report(problem: Problem): void {
    this.note(problem);
  }

  /** Listens to every page a context opens, for the app it is. */
  watch(context: BrowserContext, app: AppName): void {
    const surface = SURFACE[app];
    const onPage = (page: Page) => {
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const text = message.text();
        if (NOISE.some((pattern) => pattern.test(text))) return;
        this.note({ kind: "console", app, message: text.slice(0, 500), url: page.url() });
      });
      page.on("pageerror", (error) => {
        this.note({
          kind: "pageerror",
          app,
          message: `${error.name}: ${error.message}`.slice(0, 500),
          url: page.url(),
        });
      });
      page.on("response", (response) => {
        this.onResponse(response, app, surface);
      });
    };
    context.pages().forEach(onPage);
    context.on("page", onPage);
  }

  private onResponse(response: Response, app: AppName, surface: Surface | undefined): void {
    const url = new URL(response.url());
    if (!url.pathname.startsWith("/api/")) return;
    const status = response.status();
    const method = response.request().method();
    const where = `${method} ${url.pathname}`;
    const allowed = this.current?.allow?.includes(status) ?? false;
    if (status >= 400 && !allowed) {
      const step = this.current;
      const read = response
        .text()
        .catch(() => "")
        .then((body) => {
          const problem: Problem = {
            kind: "http",
            app,
            status,
            url: where,
            message: `${where} ${String(status)} ${body.slice(0, 300)}`,
          };
          if (step === null) this.loose.push(problem);
          else step.problems.push(problem);
        });
      this.contractChecks.push(read);
    }
    if (surface === undefined) return;
    if (!(response.headers()["content-type"] ?? "").includes("application/json")) return;
    const step = this.current;
    const check = response
      .json()
      .then((body: unknown) => {
        for (const error of contractErrors(surface, method, url.pathname, status, body).slice(0, 3)) {
          const problem: Problem = { kind: "contract", app, url: where, status, message: error.slice(0, 600) };
          if (step === null) this.loose.push(problem);
          else step.problems.push(problem);
        }
      })
      .catch(() => undefined);
    this.contractChecks.push(check);
  }

  /**
   * Runs one step. It fails, but the run goes on, when `work` throws or anything went wrong on a page meanwhile;
   * `heal`, when given, then makes what later steps need some other way, and the step reads as healed.
   */
  async run<T>(
    meta: StepMeta,
    work: () => Promise<T>,
    options: { heal?: () => Promise<T>; pages?: readonly Page[]; screen?: () => Page | undefined } = {},
  ): Promise<T | undefined> {
    const record: StepRecord = {
      ...meta,
      id: this.nextId++,
      day: this.clock.day,
      sim: label(this.clock.now),
      simAt: new Date(this.clock.now).toISOString(),
      status: "passed",
      ms: 0,
      problems: this.loose,
    };
    this.loose = [];
    this.current = record;
    const started = Date.now();
    let value: T | undefined;
    try {
      value = await work();
    } catch (error) {
      record.problems.push({ kind: "error", app: meta.app, message: errorText(error) });
    }
    await this.settle();
    this.current = null;
    record.ms = Date.now() - started;
    if (record.problems.length > 0) {
      record.status = "failed";
      const made = options.screen?.();
      record.shot = await this.shoot(record.id, made === undefined ? options.pages : [made, ...(options.pages ?? [])]);
      if (options.heal !== undefined) {
        try {
          value = await options.heal();
          record.status = "healed";
          record.healed = "made through the API so later steps have it";
        } catch (error) {
          record.problems.push({ kind: "error", app: meta.app, message: `heal: ${errorText(error)}` });
        }
      }
    }
    this.records.push(record);
    appendFileSync(this.file, `${JSON.stringify(record)}\n`);
    const mark = record.status === "passed" ? "ok " : record.status === "healed" ? "HEAL" : "FAIL";
    console.log(
      `${mark} ${record.sim} ${meta.wave} ${meta.app} ${meta.workflow}: ${meta.action} (${String(record.ms)} ms)`,
    );
    if (record.status !== "passed") {
      for (const problem of record.problems.slice(0, 4))
        console.log(`     ${problem.kind}: ${problem.message.slice(0, 240)}`);
    }
    return value;
  }

  /** Waits for the answers a step's pages are still reading, so their faults land on it. */
  private async settle(): Promise<void> {
    const checks = this.contractChecks;
    this.contractChecks = [];
    await Promise.race([Promise.all(checks), new Promise((resolve) => setTimeout(resolve, 3_000))]);
  }

  private async shoot(id: number, pages: readonly Page[] | undefined): Promise<string | undefined> {
    const page = pages?.find((each) => !each.isClosed());
    if (page === undefined) return undefined;
    const path = join(OUT, "shots", `${String(id)}.png`);
    try {
      await page.screenshot({ path, timeout: 3_000 });
      return path;
    } catch {
      return undefined;
    }
  }
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  // Playwright's messages carry a call log; its first lines say what failed.
  return error.message.split("\n").slice(0, 6).join(" | ").slice(0, 900);
}

/** Throws with `message` unless `held`: a check inside a step. */
export function check(held: boolean, message: string): void {
  if (!held) throw new Error(message);
}
