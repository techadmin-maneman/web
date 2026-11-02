// Who is signed in, as a laptop's console has it: no Access in front, the Staff list not enforced, so every call goes
// ahead; and the cities served, which the header's picker offers (ADR 0225). A spec names the cities it needs.

import type { Page } from "@playwright/test";
import { ROUTE_NEEDS } from "../../../src/policy/console-routes.ts";
import { shell } from "../../../apps/ops/src/content.ts";
import { json, type Answer, type OpsReply } from "../answer.ts";

export const signedInLocally = (cities: readonly string[]): Answer =>
  json({
    signed_in_as: "ops@localhost",
    sign_out: null,
    staff: { enforced: false, listed: false, grants: [], may_call: Object.keys(ROUTE_NEEDS) },
    cities: [...cities],
    every_city: true,
  } satisfies OpsReply<"/api/whoami">);

/** Narrows the console to a city with the header's picker, as a person does. */
export async function chooseCity(page: Page, city: string): Promise<void> {
  const header = page.getByRole("banner");
  await header.getByRole("button", { name: new RegExp(`^${shell.city.name}: `) }).click();
  await header.getByRole("button", { name: city, exact: true }).click();
}
