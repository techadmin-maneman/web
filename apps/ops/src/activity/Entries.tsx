// Activity's entries as sentences, a panel a day, the newest first: who, what they did and the record, each name a
// link where the console has a page for it. A row's time opens what the log kept: the call, the IDs, the codes.

import { Badge } from "@maneman/ui/Badge";
import { DescriptionList } from "@maneman/ui/DescriptionList";
import { FormDrawer } from "@maneman/ui/FormDrawer";
import { Initials } from "@maneman/ui/Initials";
import { ListRow, ListRows } from "@maneman/ui/ListRow";
import { Panel } from "@maneman/ui/Panel";
import { TextButton } from "@maneman/ui/TextLink";
import { apiNow } from "@maneman/web-kit/clock";
import { addDays, indiaClock, indiaDate, longDate, weekdayDate, todayInIndia } from "@maneman/web-kit/dates";
import { SectionHead } from "@maneman/ui/SectionHead";
import { useState, type ReactNode } from "react";
import type { ActivityEntry } from "../api.ts";
import { activity } from "../content/activity.ts";
import { OpsLink } from "../frame/Shell.tsx";
import { clientPath, dispatchPath, technicianPath } from "../route.ts";
import { routeOf, sentenceOf, type Named } from "./sentence.ts";
import styles from "./activity-screen.module.css";

const copy = activity;

function pageOf(opens: Named["opens"]): string | null {
  if (opens === null) return null;
  if (opens.kind === "client") return clientPath(opens.id, "visits");
  if (opens.kind === "visit") return dispatchPath({ visit: opens.id });
  return technicianPath(opens.id);
}

/** A name in a sentence, a link where it has a page. */
function Name({ named }: { named: Named }) {
  const page = pageOf(named.opens);
  return page === null ? named.words : <OpsLink to={page}>{named.words}</OpsLink>;
}

function Entry({ entry, onOpen }: { entry: ActivityEntry; onOpen: () => void }) {
  const sentence = sentenceOf(entry);
  const clock = indiaClock(entry.at);
  return (
    <ListRow
      mark={<Initials name={sentence.who.words} small />}
      title={
        <span className={styles.sentence}>
          <span className={styles.who}>
            <Name named={sentence.who} />
          </span>{" "}
          {sentence.before}
          {sentence.named !== null && <Name named={sentence.named} />}
          {sentence.after}
          {sentence.refused && (
            <Badge tone="error" className={styles.refused}>
              {copy.columns.refused}
            </Badge>
          )}
        </span>
      }
      end={
        <TextButton tone="muted" compact aria-label={copy.details(clock)} onClick={onOpen}>
          {clock}
        </TextButton>
      }
    />
  );
}

/** What the log kept besides the call: IDs, counts and codes, each by its name. */
function keptOf(detail: ActivityEntry["detail"]): string | null {
  if (detail === null) return null;
  const kept = Object.entries(detail)
    .filter(([name]) => !["method", "route", "path", "refused"].includes(name))
    .map(([name, value]) => `${name}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
  return kept.length === 0 ? null : kept.join(" · ");
}

/** What the log kept of one entry, in full: when, who and from where, the action and the call, the record. */
function Details({ entry, onClose }: { entry: ActivityEntry; onClose: () => void }) {
  const columns = copy.columns;
  const call = routeOf(entry.detail);
  const kept = keptOf(entry.detail);
  const { subject } = entry;
  const items = [
    { term: columns.when, details: `${longDate(entry.at)}, ${indiaClock(entry.at)}` },
    { term: columns.who, details: <Name named={sentenceOf(entry).who} /> },
    { term: columns.whoIs, details: `${copy.filters.kinds[entry.actor.kind]} · ${entry.actor.id}` },
    { term: columns.from, details: copy.surfaces[entry.surface] },
    {
      term: columns.action,
      details: Object.hasOwn(copy.actions, entry.action) ? copy.actions[entry.action] : entry.action,
    },
    ...(call === null
      ? []
      : [{ term: columns.call, details: <code className={styles.call}>{`${call.method} ${call.route}`}</code> }]),
    ...(subject === null
      ? []
      : [
          {
            term: columns.record,
            details: `${copy.kinds[subject.kind] ?? subject.kind}${subject.label === null ? "" : ` · ${subject.label}`}`,
          },
          { term: columns.recordId, details: <code className={styles.call}>{subject.id}</code> },
        ]),
    ...(kept === null ? [] : [{ term: copy.kept, details: <code className={styles.call}>{kept}</code> }]),
    ...(entry.detail?.refused === undefined ? [] : [{ term: columns.refused, details: copy.yes }]),
  ];
  return (
    <FormDrawer title={copy.detailsTitle} onClose={onClose}>
      <DescriptionList items={items} layout="list" />
    </FormDrawer>
  );
}

/** A day's heading: today, yesterday, or the day itself. */
function dayWords(day: string, today: string): string {
  if (day === today) return copy.today;
  if (day === addDays(today, -1)) return copy.yesterday;
  return weekdayDate(day);
}

/** A day's entries: in a panel of their own on Activity's page, under a list's heading in a record's panel. */
function Day({
  day,
  title,
  within,
  children,
}: {
  day: string;
  title: string;
  within: boolean;
  children: (inPanel: boolean) => ReactNode;
}) {
  const titleId = `activity-${day}`;
  if (!within) {
    return (
      <Panel titleId={titleId} title={title}>
        {children(true)}
      </Panel>
    );
  }
  return (
    <section aria-labelledby={titleId}>
      <SectionHead id={titleId} title={title} level={3} size="list" ruled={false} />
      {children(false)}
    </section>
  );
}

/**
 * The entries a day at a time, newest first, as the log gives them; `within` a record's panel, as a client's History
 * tab, each day under a heading rather than in a panel of its own.
 */
export function Entries({ entries, within = false }: { entries: readonly ActivityEntry[]; within?: boolean }) {
  const [open, setOpen] = useState<ActivityEntry | null>(null);
  const today = todayInIndia(apiNow());
  const days = new Map<string, ActivityEntry[]>();
  for (const entry of entries) {
    const day = indiaDate(entry.at);
    days.set(day, [...(days.get(day) ?? []), entry]);
  }
  return (
    <>
      {[...days].map(([day, theirs]) => (
        <Day key={day} day={day} title={dayWords(day, today)} within={within}>
          {(inPanel) => (
            <ListRows inPanel={inPanel}>
              {theirs.map((entry) => (
                <Entry
                  key={entry.id}
                  entry={entry}
                  onOpen={() => {
                    setOpen(entry);
                  }}
                />
              ))}
            </ListRows>
          )}
        </Day>
      ))}
      {open !== null && (
        <Details
          entry={open}
          onClose={() => {
            setOpen(null);
          }}
        />
      )}
    </>
  );
}
