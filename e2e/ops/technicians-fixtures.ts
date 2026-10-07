// What the technician page browser tests share (technicians*.e2e.ts): the technicians and their leave, the calls the
// pages make, the roster opened with the API answering them, and a technician's own page.

import type { Page } from "@playwright/test";
import { expect } from "../support.ts";
import {
  answer,
  json,
  LEAVE_CANCELLED,
  LEAVE_RECORDED,
  NO_LEAVE,
  SANDEEP_LEAVE,
  STOCK,
  TASKS_READ_ON,
  TECHNICIAN_WORK,
  TECHNICIANS,
  type Answers,
  type Call,
} from "./fixtures.ts";

export const IMRAN = "88000000-0000-4000-8000-000000000001";

export const SANDEEP = "88000000-0000-4000-8000-000000000002";

export const FAIZAN = "88000000-0000-4000-8000-000000000003";

export const REVOKE = `/api/technicians/${IMRAN}/devices/a41c09e27f3b/revoke` as const;

export const LEAVE = `/api/technicians/${IMRAN}/leave` as const;

export const CANCEL = `/api/technicians/${SANDEEP}/leave/89000000-0000-4000-8000-000000000001/cancel` as const;

export const READ_ROSTER = "GET /api/technicians" as const satisfies Call;

export const READ_WORK = "GET /api/technicians/work" as const satisfies Call;

export const READ_STOCK = "GET /api/stock" as const satisfies Call;

export const IMRANS_LEAVE = `GET ${LEAVE}` as const satisfies Call;

export const SANDEEPS_LEAVE = `GET /api/technicians/${SANDEEP}/leave` as const satisfies Call;

export const FAIZANS_LEAVE = `GET /api/technicians/${FAIZAN}/leave` as const satisfies Call;

export const REVOKE_IT = `POST ${REVOKE}` as const satisfies Call;

export const RECORD_LEAVE = `POST ${LEAVE}` as const satisfies Call;

export const CANCEL_LEAVE = `POST ${CANCEL}` as const satisfies Call;

export const PHONE = "Revoke Chrome on Android · 7f3b of Imran Qureshi";

// --ink, a primary button's own
export /**
 * What the roster and each technician's page are answered with, and `changed` over them. A newer answer() passes
 * nothing on to an older one, so a spec that changes one answer midway sends the whole set again.
 */
function answersWith(changed: Answers = {}): Answers {
  return {
    [READ_ROSTER]: json(TECHNICIANS),
    [READ_WORK]: json(TECHNICIAN_WORK),
    [IMRANS_LEAVE]: json(NO_LEAVE),
    [SANDEEPS_LEAVE]: json(SANDEEP_LEAVE),
    [FAIZANS_LEAVE]: json(NO_LEAVE),
    [READ_STOCK]: json(STOCK),
    [REVOKE_IT]: json({ revoked_at: "2027-09-22T06:00:00.000Z" }),
    [RECORD_LEAVE]: json(LEAVE_RECORDED),
    [CANCEL_LEAVE]: json(LEAVE_CANCELLED),
    ...changed,
  };
}

export async function open(page: Page, changed: Answers = {}): Promise<void> {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, answersWith(changed));
  await page.goto("/technicians");
  await expect(page.getByRole("heading", { level: 1, name: "Technicians" })).toBeVisible();
}

/** Opens a technician's page from the roster by their name, on the tab named, or on their week. */
export async function pageOf(page: Page, name: string, tab?: string) {
  await page.getByRole("link", { name, exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
  if (tab !== undefined) await page.getByRole("link", { name: tab, exact: true }).click();
  return page.getByRole("main");
}

/** Back to the roster from a technician's page. */
export async function backToRoster(page: Page) {
  await page.getByRole("link", { name: "All technicians" }).click();
  await expect(page.getByRole("table")).toBeVisible();
}
