// Home's rows (design/client-redesign, Home), each opening its page. Once fitted: the issues still open, the free
// service visits held, reporting an issue, the invite once Refer is open, and the last visit. Before the first fit: the
// four hair systems compared, and questions on WhatsApp. Once a visit is booked, the row asking for this phone's
// notifications, until they are on.

import { CLIENT_ICONS } from "@maneman/brand/icons";
import { ListRow, ListRows } from "@maneman/ui/ListRow";
import { textLinkLook } from "@maneman/ui/TextLink";
import { useLoad } from "@maneman/ui/useLoad";
import { dayMonth } from "@maneman/web-kit/dates";
import { whatsappChat } from "@maneman/web-kit/whatsapp";
import { firstNameOf } from "@rules/lib/names.ts";
import { NotificationsRow } from "../alerts/index.ts";
import { api, type Me } from "../api.ts";
import { hairSystems, home, profile, promiseOf, whatsapp } from "../content.ts";
import { AppLink } from "../frame/Shell.tsx";
import { careHoursOf, openIssues } from "../lib/counts.ts";
import { visitTitle } from "../lib/visit.ts";
import { rewardOf } from "../refer/index.ts";
import { expiryLine } from "./HomeNotes.tsx";
import styles from "./home-rows.module.css";

function Credits({ credits }: { credits: NonNullable<Me["credits"]> }) {
  return (
    <ListRow
      lead={
        <span className={styles.count} aria-hidden="true">
          {credits.visits}
        </span>
      }
      title={home.credits.count(credits.visits)}
      meta={home.rows.creditsMeta(
        credits.earliest_expiry === null ? null : expiryLine(credits, credits.earliest_expiry),
      )}
      to="/rewards"
      chevron
    />
  );
}

function FittedRows({ me }: { me: Me }) {
  const copy = home.rows;
  const open = openIssues(me);
  return (
    <ListRows>
      {open > 0 && (
        <ListRow
          icon={CLIENT_ICONS.flag}
          title={copy.openIssues(open)}
          meta={copy.openIssuesMeta}
          to="/visits/issues"
          chevron
        />
      )}
      {me.credits !== null && <Credits credits={me.credits} />}
      <ListRow icon={CLIENT_ICONS.wrench} title={copy.report} meta={copy.reportMeta} to="/visits/issues/new" chevron />
      {me.refers && (
        <ListRow icon={CLIENT_ICONS.gift} title={copy.invite} meta={promiseOf(rewardOf(me))} to="/rewards" chevron />
      )}
    </ListRows>
  );
}

function LeadRows({ me }: { me: Me }) {
  const copy = home.rows;
  const support = profile.support;
  const hours = careHoursOf(me);
  return (
    <ListRows>
      {me.credits !== null && <Credits credits={me.credits} />}
      <ListRow
        icon={CLIENT_ICONS.layers}
        title={hairSystems.compare}
        meta={copy.compareMeta}
        to="/hair-systems"
        chevron
      />
      <ListRow
        icon={CLIENT_ICONS.help}
        title={me.consulted === null ? copy.questions : copy.questionsFit}
        meta={
          hours === null
            ? undefined
            : support.hint(
                support.within(hours.first_reply),
                support.hours(support.hour(hours.opens), support.hour(hours.closes)),
              )
        }
        href={whatsappChat(whatsapp.number)}
        chevron
      />
      {me.refers && (
        <ListRow icon={CLIENT_ICONS.gift} title={copy.invite} meta={promiseOf(rewardOf(me))} to="/rewards" chevron />
      )}
    </ListRows>
  );
}

/** The last visit done, and the way to all of them. */
function LastVisit() {
  const [loaded] = useLoad(api.visits);
  const last = loaded.state === "loaded" ? loaded.value.past.find((visit) => visit.status === "completed") : undefined;
  if (last === undefined) return null;
  return (
    <section aria-labelledby="last-visit">
      <div className={styles.head}>
        <h2 className={styles.title} id="last-visit">
          {home.lastVisit.title}
        </h2>
        <AppLink className={textLinkLook({ className: styles.all })} to="/visits">
          {home.lastVisit.all}
        </AppLink>
      </div>
      <ListRows>
        <ListRow
          icon={CLIENT_ICONS.calendar}
          title={`${dayMonth(last.date)} · ${visitTitle(last)}`}
          meta={last.technician === null ? undefined : firstNameOf(last.technician.name)}
          to={`/visits/${last.id}`}
          chevron
        />
      </ListRows>
    </section>
  );
}

/** A visit is on the books, or one has been: the client knows what the notifications will be about. */
const hasBooked = (me: Me): boolean =>
  me.state === "fitted" || me.next_visit !== null || me.consultation !== null || me.being_booked !== null;

export function HomeRows({ me }: { me: Me }) {
  const fitted = me.state === "fitted";
  return (
    <>
      {fitted ? <FittedRows me={me} /> : <LeadRows me={me} />}
      {hasBooked(me) && <NotificationsRow />}
      {fitted && <LastVisit />}
    </>
  );
}
