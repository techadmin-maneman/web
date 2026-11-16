// Your hair system (design/client-redesign, the piece screen; docs/decisions/0253-replacement-when-due-and-change-of-
// hair-system.md): the one worn now, when it was fitted, how long it lasts and when its replacement opens; what a
// replacement involves, booked here once it may be (ADR 0086); every one worn before, from the visits that fitted
// them; and the four to compare.

import { CLIENT_ICONS } from "@maneman/brand/icons";
import { DescriptionList } from "@maneman/ui/DescriptionList";
import { ListRow, ListRows } from "@maneman/ui/ListRow";
import { NumberedSteps } from "@maneman/ui/NumberedSteps";
import { textLinkLook } from "@maneman/ui/TextLink";
import { Timeline, type TimelineItem } from "@maneman/ui/Timeline";
import { useLoad } from "@maneman/ui/useLoad";
import { apiNow } from "@maneman/web-kit/clock";
import { fullDate, todayInIndia } from "@maneman/web-kit/dates";
import { api, type Me, type VisitSummary } from "../api.ts";
import { BookButton } from "../booking/index.ts";
import { hairSystems, messages, profile, replacement, titles } from "../content.ts";
import { AppLink, Shell } from "../frame/Shell.tsx";
import { visitName } from "../lib/visit.ts";
import { useSession } from "../session.ts";
import { monthWorn } from "./month-worn.ts";
import styles from "./hair-system.module.css";

function Worn({ worn, open }: { worn: NonNullable<Me["hair_system"]>; open: boolean }) {
  const copy = hairSystems;
  return (
    <section aria-labelledby="worn">
      <p className={styles.eyebrow}>{copy.wearing}</p>
      <h2 className={styles.name} id="worn">
        {worn.name}
      </h2>
      <DescriptionList
        layout="list"
        items={[
          { term: copy.fitted, details: fullDate(worn.fitted_on) },
          { term: copy.life, details: copy.lifeIs(worn.replace_after_months, fullDate(worn.due_on)) },
          { term: copy.replacement, details: open ? copy.openNow : copy.opens(fullDate(worn.replacement_opens_on)) },
        ]}
      />
    </section>
  );
}

/** Each fitting done, newest first: from its day to the next one's, or to now for the one worn. */
function fittings(past: readonly VisitSummary[], today: string): TimelineItem[] {
  const fitted = past.filter(
    (visit) => (visit.type === "first_fit" || visit.type === "replacement") && visit.status === "completed",
  );
  return fitted.map((visit, index) => {
    const next = fitted[index - 1];
    return {
      key: visit.id,
      when: hairSystems.span(
        fullDate(visit.date),
        next === undefined ? null : fullDate(next.date),
        monthWorn(visit.date, next?.date ?? today),
      ),
      who: visit.service ?? visitName(visit.type),
      text: (
        <AppLink className={textLinkLook({ inline: true })} to={`/visits/${visit.id}`}>
          {hairSystems.fittingVisit}
        </AppLink>
      ),
      tone: index === 0 ? "ours" : "theirs",
    };
  });
}

function WornBefore({ today }: { today: string }) {
  const [loaded] = useLoad(api.visits);
  if (loaded.state !== "loaded") return null;
  const items = fittings(loaded.value.past, today);
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="worn-before">
      <h2 className={styles.section} id="worn-before">
        {hairSystems.worn}
      </h2>
      <Timeline items={items} />
    </section>
  );
}

export function HairSystemScreen() {
  const { me } = useSession();
  const open = me.booking.types.includes("replacement");
  const offered = me.booking.next?.type === "replacement" ? me.booking.next : null;
  const book = open ? (
    <BookButton
      className={styles.book}
      type="replacement"
      label={replacement.book}
      message={messages.bookReplacement}
      tier={offered?.tier}
      offer={offered === null ? undefined : { date: offered.date, window: offered.window }}
    />
  ) : undefined;
  return (
    <Shell header={{ kind: "back", title: titles.hairSystem, to: "/", label: profile.back }} tab={null} footer={book}>
      <div className={styles.page}>
        {me.hair_system === null ? (
          <p className={styles.none}>{hairSystems.none}</p>
        ) : (
          <Worn worn={me.hair_system} open={open} />
        )}
        <section aria-labelledby="involves">
          <h2 className={styles.section} id="involves">
            {replacement.title}
          </h2>
          <NumberedSteps steps={replacement.lines} />
        </section>
        <WornBefore today={todayInIndia(apiNow())} />
        <ListRows>
          <ListRow
            icon={CLIENT_ICONS.layers}
            title={hairSystems.compare}
            meta={hairSystems.compareMeta}
            to="/hair-systems"
            chevron
          />
        </ListRows>
      </div>
    </Shell>
  );
}
