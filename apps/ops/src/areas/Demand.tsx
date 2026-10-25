// Demand under Areas (docs/decisions/0224-demand-and-the-next-to-open.md): the pincodes to open next, by
// those waiting and those who looked them up on the site, and how the last thirty days' launches went.

import { Fieldset } from "@maneman/ui/Field";
import { useLoad } from "@maneman/ui/useLoad";
import { shortDate } from "@maneman/web-kit/dates";
import { areas } from "../content.ts";
import form from "../components/forms.module.css";
import shared from "./areas.module.css";
import { areasApi } from "./areas-api.ts";

const copy = areas.demand;

/** The pincodes not served, most waiting first, then most looked up. */
export function NextToOpen() {
  const [loaded] = useLoad(areasApi.nextToOpen);
  if (loaded.state !== "loaded") return null;
  const { pincodes } = loaded.value;
  return (
    <Fieldset className={form.group} legend={copy.nextTitle} legendLook="title">
      {pincodes.length === 0 && <p className={shared.note}>{copy.nextNone}</p>}
      <ul className={shared.launchList}>
        {pincodes.map((each) => (
          <li key={each.pincode} className={shared.launchItem}>
            <p className={shared.launchLine}>
              {each.pincode} {copy.place(each.city, each.area, each.district, each.state)}
            </p>
            <p className={shared.note}>{copy.figures(each.waiting, each.looked)}</p>
          </li>
        ))}
      </ul>
    </Fieldset>
  );
}

/** The pincodes launched in the last thirty days, newest first, with who was told and what has been booked. */
export function RecentLaunches() {
  const [loaded] = useLoad(areasApi.recentLaunches);
  if (loaded.state !== "loaded") return null;
  const { launches } = loaded.value;
  return (
    <Fieldset className={form.group} legend={copy.recentTitle} legendLook="title">
      {launches.length === 0 && <p className={shared.note}>{copy.recentNone}</p>}
      <ul className={shared.launchList}>
        {launches.map((each) => (
          <li key={each.pincode} className={shared.launchItem}>
            <p className={shared.launchLine}>
              {copy.recent(each.pincode, each.area, each.city, shortDate(each.launched_on))}
            </p>
            <p className={shared.note}>{copy.recentFigures(each.told, each.booked)}</p>
          </li>
        ))}
      </ul>
    </Fieldset>
  );
}
