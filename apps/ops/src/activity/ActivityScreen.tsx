// Activity: the audit log, read in the console by Admin's View (src/routes/ops/activity.ts). Every entry, newest
// first: when, who, what, and the record it touched; a call's own path beneath what it was. What the log is narrowed
// to lives in the page's address (./filters.ts), so a client's whole record, linked from their History tab, opens
// already narrowed. The design draws no board for it; it is built as Areas' tables are.

import { Button } from "@maneman/ui/Button";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaClock, longDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { api, type ActivityEntry } from "../api.ts";
import { OpsLink, Shell } from "../components/Shell.tsx";
import { activity } from "../content.ts";
import { clientPath, dispatchPath, technicianPath } from "../route.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "./activity.module.css";
import { activityPath, askedOf, filtersOf, type Filters } from "./filters.ts";
import { Narrow } from "./Narrow.tsx";

const copy = activity;

/** Where the console shows the person who made an entry: a client's page or a technician's; none for staff. */
function pageOf(actor: ActivityEntry["actor"]): string | null {
  if (actor.kind === "client") return clientPath(actor.id, "visits");
  if (actor.kind === "technician") return technicianPath(actor.id);
  return null;
}

/** Who made the entry, linked to their page where the console has one. */
function Who({ actor, surface }: Pick<ActivityEntry, "actor" | "surface">) {
  const named = actor.name ?? (actor.kind === "client" ? copy.unnamedClient : actor.id);
  const page = pageOf(actor);
  return (
    <>
      {page === null ? <span className={styles.who}>{named}</span> : <OpsLink to={page}>{named}</OpsLink>}
      <span className={styles.sub}>
        {copy.filters.kinds[actor.kind]} · {copy.surfaces[surface]}
      </span>
    </>
  );
}

/** What the entry was, and for a call the method and path it made, IDs only. */
function What({ action, detail }: Pick<ActivityEntry, "action" | "detail">) {
  const path = typeof detail?.path === "string" ? detail.path : null;
  const method = typeof detail?.method === "string" ? detail.method : null;
  // The log keeps actions an earlier build wrote under names this one no longer has words for.
  const said = Object.hasOwn(copy.actions, action) ? copy.actions[action] : action;
  return (
    <>
      <span>{said}</span>
      {path !== null && (
        <code className={styles.call}>
          {method} {path}
        </code>
      )}
    </>
  );
}

/** The record the entry touched: a client's page, a visit on the board, or its kind and ID. */
function Record({ subject }: Pick<ActivityEntry, "subject">) {
  if (subject === null) return null;
  if (subject.kind === "person") return <OpsLink to={clientPath(subject.id, "visits")}>{copy.records.person}</OpsLink>;
  if (subject.kind === "appointment") {
    return <OpsLink to={dispatchPath({ visit: subject.id })}>{copy.records.appointment}</OpsLink>;
  }
  return (
    <span className={styles.sub}>
      {subject.kind} {subject.id.slice(0, 8)}
    </span>
  );
}

function Rows({ entries }: { entries: readonly ActivityEntry[] }) {
  return (
    <Table className={styles.table}>
      <thead>
        <tr>
          <th className={styles.when}>{copy.columns.when}</th>
          <th>{copy.columns.who}</th>
          <th>{copy.columns.what}</th>
          <th className={styles.record}>{copy.columns.record}</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.id}>
            <td className={styles.when}>
              {longDate(entry.at)}, {indiaClock(entry.at)}
            </td>
            <td className={styles.stack}>
              <Who actor={entry.actor} surface={entry.surface} />
            </td>
            <td className={styles.stack}>
              <What action={entry.action} detail={entry.detail} />
            </td>
            <td className={styles.record}>
              <Record subject={entry.subject} />
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

interface Older {
  readonly entries: readonly ActivityEntry[];
  readonly next: number | null;
}

/** The log as narrowed, a page at a time: older pages are added beneath as they are asked for. */
function Log({ filters }: { filters: Filters }) {
  const [loaded, retry] = useLoad(() => api.activity(askedOf(filters)));
  const [older, setOlder] = useState<Older | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;

  const entries = [...loaded.value.entries, ...(older?.entries ?? [])];
  const next = older === null ? loaded.value.next_before : older.next;
  const showOlder = async (before: number) => {
    setLoadingOlder(true);
    const answer = await api.activity(askedOf(filters, before));
    setLoadingOlder(false);
    if (!answer.ok) return;
    setOlder({ entries: [...(older?.entries ?? []), ...answer.body.entries], next: answer.body.next_before });
  };
  if (entries.length === 0) return <p className={styles.empty}>{copy.empty}</p>;
  return (
    <>
      <Rows entries={entries} />
      {next !== null && (
        <Button
          variant="outline"
          size="small"
          className={styles.older}
          busy={loadingOlder}
          onClick={() => void showOlder(next)}
        >
          {loadingOlder ? copy.loadingOlder : copy.older}
        </Button>
      )}
    </>
  );
}

export function ActivityScreen() {
  const [filters, setFilters] = useState(() => filtersOf(window.location.search));
  const apply = (next: Filters) => {
    window.history.replaceState(window.history.state, "", activityPath(next));
    setFilters(next);
  };
  return (
    <Shell section="/activity" title={copy.title}>
      <div className={styles.column}>
        <p className={styles.intro}>{copy.intro}</p>
        <Narrow filters={filters} onApply={apply} />
        <Log key={activityPath(filters)} filters={filters} />
      </div>
    </Shell>
  );
}
