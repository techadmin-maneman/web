// Home's rows (design/client-redesign, Home): the free service visits a client holds, reporting an issue once fitted,
// and the invite once Refer is open to them, each a row that opens its page.

import { CLIENT_ICONS } from "@maneman/brand/icons";
import { ListRow, ListRows } from "@maneman/ui/ListRow";
import type { Me } from "../api.ts";
import { home, promiseOf } from "../content.ts";
import { expiryLine } from "./HomeNotes.tsx";
import styles from "./home-rows.module.css";

export function HomeRows({ me }: { me: Me }) {
  const copy = home.rows;
  const credits = me.credits;
  const fitted = me.state === "fitted";
  if (credits === null && !fitted && !me.refers) return null;
  return (
    <ListRows>
      {credits !== null && (
        <ListRow
          lead={
            <span className={styles.count} aria-hidden="true">
              {credits.visits}
            </span>
          }
          title={home.credits.count(credits.visits)}
          meta={copy.creditsMeta(
            credits.earliest_expiry === null ? null : expiryLine(credits, credits.earliest_expiry),
          )}
          to="/rewards"
          chevron
        />
      )}
      {fitted && (
        <ListRow
          icon={CLIENT_ICONS.wrench}
          title={copy.report}
          meta={copy.reportMeta}
          to="/visits/issues/new"
          chevron
        />
      )}
      {me.refers && (
        <ListRow
          icon={CLIENT_ICONS.gift}
          title={copy.invite}
          meta={promiseOf(me.referral_reward)}
          to="/rewards"
          chevron
        />
      )}
    </ListRows>
  );
}
