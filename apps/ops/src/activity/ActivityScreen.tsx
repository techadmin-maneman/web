// Activity: the audit log, read in the console by Admin's View (src/routes/ops/activity.ts). Every entry, newest
// first: when, who, what, and the record it touched; a call's own path beneath what it was. What the log is narrowed
// to lives in the page's address (./filters.ts), so a client's whole record, linked from their History tab, opens
// already narrowed. The design draws no board for it; it is built as Areas' tables are.

import { ROUTE_NEEDS } from "@rules/policy/console-routes.ts";
import { EmptyState } from "@maneman/ui/EmptyState";
import { Chip } from "@maneman/ui/Chip";
import { Button } from "@maneman/ui/Button";
import { Table } from "@maneman/ui/Table";
import { Toolbar } from "@maneman/ui/Toolbar";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaClock, longDate } from "@maneman/web-kit/dates";
import { useCallback, useState } from "react";
import { type ActivityEntry } from "../api.ts";
import { DrawerButton } from "../components/DrawerButton.tsx";
import { OpsLink } from "../components/Shell.tsx";
import { activity } from "../content/activity.ts";
import { activityPath, clientPath, dispatchPath, technicianPath } from "../route.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "./activity-screen.module.css";
import { appliedOf, askedOf, filtersOf, type Filters } from "./filters.ts";
import { Narrow } from "./Narrow.tsx";
import { activityApi } from "./activity-api.ts";

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

const TEMPLATES = Object.keys(ROUTE_NEEDS).map((key) => {
  const [method = "", template = ""] = key.split(" ");
  return { method, template, pattern: new RegExp(`^${template.replace(/\{[^}]+\}/g, "[^/]+")}$`) };
});

/** A call's path as the route it reached, "/api/stock/lots/{id}": the record it touched is named beside it. */
const routeOf = (method: string, path: string): string =>
  TEMPLATES.find((each) => each.method === method && each.pattern.test(path))?.template ??
  path.replace(/[0-9a-f-]{36}/g, "{id}");

/** What the entry was, and for a call the method and the route it reached, never an ID. */
function What({ action, detail }: Pick<ActivityEntry, "action" | "detail">) {
  const method = typeof detail?.method === "string" ? detail.method : null;
  const path = typeof detail?.path === "string" ? routeOf(method ?? "", detail.path) : null;
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
  readonly next: string | null;
}

/** The log as narrowed, a page at a time: older pages are added beneath as they are asked for. */
function Log({ filters }: { filters: Filters }) {
  const [loaded, retry] = useLoad(useCallback(() => activityApi.activity(askedOf(filters)), [filters]));
  const [older, setOlder] = useState<Older | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderFailed, setOlderFailed] = useState<{ requestId: string | null } | null>(null);
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;

  const entries = [...loaded.value.entries, ...(older?.entries ?? [])];
  const next = older === null ? loaded.value.next_cursor : older.next;
  const showOlder = async (cursor: string) => {
    setLoadingOlder(true);
    const answer = await activityApi.activity(askedOf(filters, cursor));
    setLoadingOlder(false);
    setOlderFailed(answer.ok ? null : { requestId: answer.requestId });
    if (!answer.ok) return;
    setOlder({ entries: [...(older?.entries ?? []), ...answer.body.entries], next: answer.body.next_cursor });
  };
  if (entries.length === 0) return <EmptyState look="panel" line={copy.empty} />;
  return (
    <>
      <Rows entries={entries} />
      {olderFailed !== null && next !== null && (
        <PanelFailed onRetry={() => void showOlder(next)} requestId={olderFailed.requestId} />
      )}
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

/** Each filter set, a chip with its way off: a client or visit a link narrowed to, and what Filter chose. */
function Applied({ filters, onApply }: { filters: Filters; onApply: (filters: Filters) => void }) {
  return appliedOf(filters).map(({ name, words }) => (
    <Chip
      key={name}
      removeLabel={copy.filters.remove(words)}
      onRemove={() => {
        onApply({ ...filters, [name]: undefined });
      }}
    >
      {words}
    </Chip>
  ));
}

export function ActivityScreen() {
  const [filters, setFilters] = useState(() => filtersOf(window.location.search));
  const apply = (next: Filters) => {
    window.history.replaceState(window.history.state, "", activityPath(next));
    setFilters(next);
  };
  return (
    <div className={styles.column}>
      <Toolbar label={copy.filters.label}>
        <DrawerButton label={copy.filters.filter}>
          {(close) => (
            <Narrow
              filters={filters}
              onApply={(next) => {
                apply(next);
                close();
              }}
            />
          )}
        </DrawerButton>
        <Applied filters={filters} onApply={apply} />
      </Toolbar>
      <Log key={activityPath(filters)} filters={filters} />
    </div>
  );
}
