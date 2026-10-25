// Staff's notes on a client: nothing on their page told the next member of staff what to bear in mind before a call or
// a visit. Each note now sits under the head, with who wrote it and when, changed or taken off where it stands.

import type { Route } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { CLIENT, json, type OpsReply } from "./fixtures.ts";
import { openClient } from "./clients-fixtures.ts";
import { clients } from "../../apps/ops/src/content.ts";

const copy = clients.notes;

type Notes = OpsReply<"/api/clients/{id}/notes">;

const NOTE = {
  id: "5a000000-0000-4000-8000-000000000001",
  body: "Prefers mornings.",
  written_by: "priya@maneman.in",
  written_at: "2027-09-20T05:00:00.000Z",
};

test("writes a note on the client, changes it where it stands and takes it off, each saying who and when", async ({
  page,
}) => {
  const sent: unknown[] = [];
  let notes: Notes = { notes: [] };
  await openClient(page, `/clients/${CLIENT.id}`, {
    "GET /api/clients/{id}/notes": (route: Route) => json(notes)(route),
    "POST /api/clients/{id}/notes": (route: Route) => {
      const written = route.request().postDataJSON() as { body: string; replaces: string | null };
      sent.push(written);
      notes = {
        notes: [{ ...NOTE, id: written.replaces === null ? NOTE.id : `${NOTE.id.slice(0, -1)}2`, body: written.body }],
      };
      return json(notes, 201)(route);
    },
    "POST /api/clients/{id}/notes/{note_id}/take-off": (route: Route) => {
      notes = { notes: [] };
      return json(notes)(route);
    },
  });
  const strip = page.getByRole("region", { name: copy.title });
  await expect(strip).toContainText(copy.none);

  await strip.getByRole("button", { name: copy.add }).click();
  await strip.getByLabel(copy.label).fill(NOTE.body);
  await strip.getByRole("button", { name: copy.save }).click();
  await expect(strip.getByRole("listitem")).toHaveText([new RegExp(`^${NOTE.body}`)]);
  await expect(strip).toContainText(copy.by("Priya", "20 Sep 2027"));
  expect(await axeViolations(page)).toEqual([]);

  await strip.getByRole("button", { name: copy.change }).click();
  await expect(strip.getByLabel(copy.label)).toHaveValue(NOTE.body);
  await strip.getByLabel(copy.label).fill("Prefers early mornings.");
  await strip.getByRole("button", { name: copy.save }).click();
  await expect(strip.getByRole("listitem")).toHaveText([/^Prefers early mornings\./]);

  await strip.getByRole("button", { name: copy.takeOff }).click();
  await expect(strip).toContainText(copy.none);
  expect(sent).toEqual([
    { body: NOTE.body, replaces: null },
    { body: "Prefers early mornings.", replaces: NOTE.id },
  ]);
});
