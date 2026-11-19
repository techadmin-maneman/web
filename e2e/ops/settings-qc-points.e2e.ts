// The checks on a hair system that arrives, beneath Settings › Purchasing
// (docs/decisions/0283-changed-and-deleted-while-unused.md): each a row that opens its record, renamed and switched on
// or off there, and deleted while no claim names it. They were five fixed points, only switched on or off.

import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { empty, json, QC_POINTS } from "./fixtures.ts";
import { open, posted } from "./settings-fixtures.ts";
import { deleting, EDITING } from "../../apps/ops/src/content/common.ts";
import { purchasing } from "../../apps/ops/src/content/purchasing.ts";

const copy = purchasing.points;
const [DENSITY, KNOTS] = QC_POINTS.points;

test.describe("the checks on a hair system that arrives", () => {
  test("lists each check and whether it is made, and deletes one no claim names, not one a claim does", async ({
    page,
  }) => {
    await open(page, "/settings/purchasing", { "DELETE /api/qc-points/{id}": empty() });
    const panel = page.getByRole("region", { name: copy.panel });
    await expect(panel.getByRole("row").filter({ hasText: DENSITY?.name ?? "" })).toContainText(copy.yes);
    await expect(panel.getByRole("row").filter({ hasText: KNOTS?.name ?? "" })).toContainText(copy.no);
    expect(await axeViolations(page)).toEqual([]);

    await panel.getByRole("button", { name: DENSITY?.name ?? "" }).click();
    const density = page.getByRole("dialog", { name: DENSITY?.name ?? "" });
    await expect(density).toContainText(copy.inUse);
    await expect(density.getByRole("button", { name: deleting.label(DENSITY?.name ?? "") })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await panel.getByRole("button", { name: KNOTS?.name ?? "" }).click();
    const knots = page.getByRole("dialog", { name: KNOTS?.name ?? "" });
    await knots.getByRole("button", { name: deleting.label(KNOTS?.name ?? "") }).click();
    const deleted = page.waitForRequest(
      (request) => request.method() === "DELETE" && request.url().endsWith("/api/qc-points/q-knots"),
    );
    await knots.getByRole("button", { name: deleting.confirm, exact: true }).click();
    await deleted;
    await expect(page.getByRole("status").filter({ hasText: copy.deleted })).toBeVisible();
  });

  test("switches a check on where it reads, sending its name as it stands", async ({ page }) => {
    await open(page, "/settings/purchasing", {
      "PATCH /api/qc-points/{id}": json({ ...KNOTS, checked: true }),
    });
    await page
      .getByRole("region", { name: copy.panel })
      .getByRole("button", { name: KNOTS?.name ?? "" })
      .click();
    const record = page.getByRole("dialog", { name: KNOTS?.name ?? "" });
    await record.getByRole("button", { name: `${EDITING.change} ${copy.checked}` }).click();
    await record.getByRole("combobox", { name: copy.checked }).selectOption(copy.yes);
    const sent = page.waitForRequest((request) => request.method() === "PATCH");
    await record.getByRole("button", { name: EDITING.save }).click();
    expect((await sent).url()).toContain("/api/qc-points/q-knots");
    expect((await sent).postDataJSON()).toEqual({ name: KNOTS?.name, checked: true });
  });

  // A second change sent the check as the page first read it, undoing the first.
  test("sends a second change from what the first left", async ({ page }) => {
    let knots = { ...KNOTS };
    await open(page, "/settings/purchasing", {
      "GET /api/qc-points": (route) => json({ points: [DENSITY, knots] })(route),
      "PATCH /api/qc-points/{id}": (route) => {
        knots = { ...knots, ...(route.request().postDataJSON() as { name: string; checked: boolean }) };
        return json(knots)(route);
      },
    });
    await page
      .getByRole("region", { name: copy.panel })
      .getByRole("button", { name: KNOTS?.name ?? "" })
      .click();
    const record = page.getByRole("dialog");
    await record.getByRole("button", { name: `${EDITING.change} ${copy.name}` }).click();
    await record.getByRole("textbox", { name: copy.name }).fill("Knot colour");
    await record.getByRole("button", { name: EDITING.save }).click();
    await record.getByRole("button", { name: `${EDITING.change} ${copy.checked}` }).click();
    await record.getByRole("combobox", { name: copy.checked }).selectOption(copy.yes);
    const sent = page.waitForRequest((request) => request.method() === "PATCH");
    await record.getByRole("button", { name: EDITING.save }).click();
    expect((await sent).postDataJSON()).toEqual({ name: "Knot colour", checked: true });
  });

  test("adds a check as typed", async ({ page }) => {
    await open(page, "/settings/purchasing", {
      "POST /api/qc-points": json({ id: "q-new", name: "Hairline shape", checked: true, deletable: true }, 201),
    });
    await page.getByRole("button", { name: copy.add }).click();
    const form = page.getByRole("group", { name: copy.add });
    await form.getByLabel(copy.name).fill("Hairline shape ");
    const sent = posted(page, "/api/qc-points");
    await form.getByRole("button", { name: copy.addButton, exact: true }).click();
    expect((await sent).postDataJSON()).toEqual({ name: "Hairline shape" });
    await expect(page.getByRole("status").filter({ hasText: copy.added })).toBeVisible();
  });
});
