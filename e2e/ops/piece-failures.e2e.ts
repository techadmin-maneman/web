// A hair system marked failed by Care, or its failure taken back, on the client's Hair systems tab, and a guarantee
// claim closed with whether its hair system was at fault (docs/decisions/0273-why-a-hair-system-failed.md).

import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { CLIENT, empty, json, PIECES, type OpsReply } from "./fixtures.ts";
import { openClient } from "./clients-fixtures.ts";
import { detail, NO_ALERTS, open } from "./tasks-fixtures.ts";
import * as opsCopy from "../../apps/ops/src/content.ts";

const copy = opsCopy.clients.pieces.failure;
const LIVE = "MM-STD-4417-C";
const FAILED = "MM-STD-4417-B";

test("marks a hair system in wear failed, why from the job sheet’s list and the day, and takes a failure back", async ({
  page,
}) => {
  const marked: OpsReply<"/api/clients/{id}/pieces"> = {
    ...PIECES,
    pieces: PIECES.pieces.map((piece) =>
      piece.piece_code === LIVE
        ? { ...piece, failed_at: "2026-11-15T06:30:00.000Z", failure_reason: "Shedding" }
        : piece,
    ),
  };
  const sent: unknown[] = [];
  let undone = "";
  await openClient(page, `/clients/${CLIENT.id}/pieces`, {
    "POST /api/clients/{id}/pieces/{code}/failure": async (route) => {
      sent.push(route.request().postDataJSON());
      await json(marked)(route);
    },
    "DELETE /api/clients/{id}/pieces/{code}/failure": async (route) => {
      undone = new URL(route.request().url()).pathname;
      await route.fulfill({ status: 204 });
    },
  });

  await page.getByRole("button", { name: copy.markLabel(LIVE) }).click();
  const drawer = page.getByRole("dialog", { name: copy.title(LIVE) });
  const mark = drawer.getByRole("button", { name: copy.mark, exact: true });
  // Off until a reason is picked; the day starts at today.
  await expect(mark).toBeDisabled();
  expect(await axeViolations(page)).toEqual([]);
  await drawer.getByLabel(copy.reason).selectOption("shedding");
  await mark.click();
  await expect
    .poll(() => sent)
    .toEqual([{ failure_reason: "shedding", failed_on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }]);
  await expect(drawer).toHaveCount(0);
  await expect(page.getByRole("row").filter({ hasText: LIVE })).toContainText("Shedding");

  await page.getByRole("button", { name: copy.undoLabel(FAILED) }).click();
  await expect.poll(() => undone).toBe(`/api/clients/${CLIENT.id}/pieces/${FAILED}/failure`);
});

test("closes a guarantee claim with its hair system at fault, why from the job sheet’s list", async ({ page }) => {
  const claim = "99000000-0000-4000-8000-000000000041";
  const board: OpsReply<"/api/tasks"> = {
    overdue: 0,
    truncated: false,
    low_stock_places: 0,
    lapsed: 0,
    staff: [],
    groups: [
      {
        group: "fit_guarantee_claim",
        count: 1,
        closable: true,
        tasks: [
          {
            id: claim,
            person: { id: CLIENT.id, name: CLIENT.name },
            facts: {
              group: "fit_guarantee_claim",
              reference: "MM-ISS-0041",
              fitted_on: "2026-11-14",
              sign_off: "signed",
              conversation_id: null,
              photos: 0,
              references: ["MM-ISS-0041"],
            },
            detail: "The edges lift at the front.",
            since: "2026-11-16T06:00:00.000Z",
            due: "2026-11-18T06:00:00.000Z",
            owner: null,
          },
        ],
      },
    ],
  };
  const closed: unknown[] = [];
  await open(page, board, NO_ALERTS, {
    [`GET /api/clients/${CLIENT.id}/pieces`]: json(PIECES),
    "POST /api/tasks/{group}/{id}/close": async (route) => {
      closed.push(route.request().postDataJSON());
      await empty()(route);
    },
  });
  const drawer = await detail(page, CLIENT.name);
  const words = opsCopy.tasks.close.guaranteeClaim;
  await drawer.getByRole("button", { name: words.open }).click();
  await drawer.getByLabel(words.label).fill("Refit booked for Thursday.");
  const fault = drawer.getByLabel(opsCopy.clients.atFault.label);
  // No is where it starts, so nothing is marked failed unless Care say so.
  await expect(fault).toHaveValue("");
  await fault.selectOption("edges_lifting");
  await drawer.getByRole("button", { name: opsCopy.tasks.close.confirm }).click();
  await expect.poll(() => closed).toEqual([{ reason: "Refit booked for Thursday.", failure_reason: "edges_lifting" }]);
});
