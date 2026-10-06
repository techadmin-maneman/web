// What the console's client page tests share (clients*.e2e.ts): the calls the page makes for one client, the page
// opened with the API answering them, and the parts of the page each test reads.

import type { Page } from "@playwright/test";
import {
  answer,
  CLIENT,
  CONSENTS,
  inkPhoto,
  jpeg,
  json,
  NO_HAIR_PROFILE,
  PHOTOS,
  PIECES,
  RECORD,
  type Answers,
  type Call,
  type OpsReply,
} from "./fixtures.ts";

export const RECORD_PATH = `/api/clients/${CLIENT.id}` as const;

export const READ_RECORD = `GET ${RECORD_PATH}` as const satisfies Call;

export const READ_PIECES = `GET ${RECORD_PATH}/pieces` as const satisfies Call;

export const READ_PHOTOS = `GET ${RECORD_PATH}/photos` as const satisfies Call;

export const VIEW_PHOTOS = `POST ${RECORD_PATH}/photos/view` as const satisfies Call;

export const READ_CONSENTS = `GET ${RECORD_PATH}/consents` as const satisfies Call;

export const READ_HAIR_PROFILE = `GET ${RECORD_PATH}/hair-profile` as const satisfies Call;

export const FIND = "POST /api/clients/find" as const satisfies Call;

export const NAME = { name: CLIENT.name, exact: true };

/** The client as a search lists them, with where they stand and their next visit. */
export const FOUND = { ...CLIENT, state: "fitted" as const, next_visit: "2027-09-25T05:00:00.000Z" };

/** The opening the API logs, at India's 10:42 by its own clock, and one before it. */
export const VIEW = {
  logged_at: "2027-09-22T05:12:00.000Z",
  before: [{ by: "ops@maneman.in", at: "2027-09-19T04:40:00.000Z" }],
} satisfies OpsReply<"/api/clients/{id}/photos/view", "post">;

/** The client's routes, with every photograph a block of ink; `over` replaces any of them. */
export async function clientRoutes(page: Page, over: Answers = {}): Promise<void> {
  await answer(page, {
    [READ_RECORD]: json(RECORD),
    [READ_PIECES]: json(PIECES),
    [READ_PHOTOS]: json(PHOTOS),
    [VIEW_PHOTOS]: json(VIEW),
    [READ_CONSENTS]: json(CONSENTS),
    [READ_HAIR_PROFILE]: json(NO_HAIR_PROFILE),
    "GET /api/clients/{id}/photos/{photo_id}": jpeg(await inkPhoto()),
    ...over,
  });
}

export async function openClient(page: Page, path: string, over: Answers = {}): Promise<void> {
  await clientRoutes(page, over);
  await page.goto(path);
}

/** The head's figures, by the name the board letters each with. The head's list is the page's first; Visits has the address's. */
export const meta = (page: Page) => page.locator("dl").first().getByRole("definition");

/** One of the client's tabs, apart from the navigation's section of the same name. */
export const clientTab = (page: Page, name: string) =>
  page.getByRole("navigation", { name: CLIENT.name }).getByRole("link", { name, exact: true });

/** Who invited the client, in the head. */
export const invitedBy = (page: Page) =>
  page
    .getByRole("term")
    .filter({ hasText: /^Invited by$/ })
    .locator("+ dd");
