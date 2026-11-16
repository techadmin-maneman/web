// The profile's Help row's line (docs/decisions/0136-care-names.md): the client's Care person by name, once Customer Care
// gave them one, then when Care reply and the hours they keep, as ops set them.

import type { components } from "../api-schema.ts";
import { profile } from "../content.ts";

type Profile = components["schemas"]["Profile"];

export function helpLine({ care_person, care_hours }: Pick<Profile, "care_person" | "care_hours">): string {
  const copy = profile.support;
  const hint = copy.hint(
    copy.within(care_hours.first_reply),
    copy.hours(copy.hour(care_hours.opens), copy.hour(care_hours.closes)),
  );
  return care_person === null ? hint : copy.named(care_person, hint);
}
