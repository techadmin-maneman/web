// What the Payments page browser tests share (no-shows*.e2e.ts): the day's money and the cases the API answers with,
// and the page opened.

import type { Page } from "@playwright/test";
import { expect } from "../support.ts";
import {
  answer,
  CHARGE_PREVIEW,
  DAY_MONEY,
  DECIDED,
  DISPUTES,
  json,
  NO_SHOWS,
  TASKS_READ_ON,
  type Call,
} from "./fixtures.ts";

export const FIRST = "Visit of Sun 19 Sep";

export const QUEUE = "No-shows to decide";

/** The fixture's day, which the clock is set to: Wednesday 22 September 2027. */
export const MONEY = "Today, Wed 22 Sep";

export const CASE = NO_SHOWS.cases[0]?.id ?? "";

export const DECIDE = `POST /api/no-shows/${CASE}/decision` as const satisfies Call;

export const DISPUTE = DISPUTES.disputes[0]?.id ?? "";

export const RULE = `POST /api/no-shows/disputes/${DISPUTE}/ruling` as const satisfies Call;

export const DISPUTED = "Vikram Sethi disputes the charge";

export const PREVIEW = `GET /api/no-shows/${CASE}/charge` as const satisfies Call;

export async function open(
  page: Page,
  decision = json({ decided: true }),
  path = "/no-shows",
  ruling = json({ ruled: true }),
): Promise<void> {
  await answer(page, {
    "GET /api/payments": json(DAY_MONEY),
    "GET /api/no-shows": json(NO_SHOWS),
    "GET /api/no-shows/disputes": json(DISPUTES),
    "GET /api/no-shows/decided": json(DECIDED),
    [PREVIEW]: json(CHARGE_PREVIEW),
    [DECIDE]: decision,
    [RULE]: ruling,
  });
  await page.clock.setFixedTime(TASKS_READ_ON);
  await page.goto(path);
  await expect(page.getByRole("heading", { name: QUEUE })).toBeVisible();
}

/** The Payments page's second card, found by its heading. */
export const disputeCard = (page: Page) => page.getByRole("region", { name: DISPUTED });
