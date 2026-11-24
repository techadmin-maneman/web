// Activity: the audit log, read in the console by Admin's View (src/routes/ops/activity.ts). Every entry a sentence,
// newest first, a panel a day (./Entries.tsx), as the redesign draws it; a row's time opens what the log kept. Its
// filters live in the page's address (./filters.ts), so a client's whole record, linked from their History tab, opens
// already narrowed; what is shown can be downloaded as a file.

import { ACTION_ICONS } from "@maneman/brand/action-icons";
import { Button } from "@maneman/ui/Button";
import { Chip } from "@maneman/ui/Chip";
import { DrawerButton } from "@maneman/ui/DrawerButton";
import { EmptyState } from "@maneman/ui/EmptyState";
import { Panel } from "@maneman/ui/Panel";
import { Checkbox } from "@maneman/ui/Field";
import { PanelFailed, PanelLoading } from "@maneman/ui/States";
import { Toolbar } from "@maneman/ui/Toolbar";
import { useLoad } from "@maneman/ui/useLoad";
import { apiNow } from "@maneman/web-kit/clock";
import { dayMonth, indiaDate, todayInIndia } from "@maneman/web-kit/dates";
import { useCallback, useMemo, useState } from "react";
import { type ActivityEntry } from "../api.ts";
import { activity } from "../content/activity.ts";
import { PageActions, useHeaderSub } from "../frame/PageHead.tsx";
import { csvText } from "../lib/csv.ts";
import { saveFile } from "../lib/save-file.ts";
import { activityPath } from "../route.ts";
import styles from "./activity-screen.module.css";
import { activityApi } from "./activity-api.ts";
import { Entries } from "./Entries.tsx";
import { appliedOf, askedOf, filtersOf, type Filters } from "./filters.ts";
import { Narrow } from "./Narrow.tsx";
import { csvRows } from "./sentence.ts";

const copy = activity;

interface Older {
  readonly entries: readonly ActivityEntry[];
  readonly next: string | null;
}

/** The days the entries shown cover, beside the page's title: "Today", or "18 Nov to Today". */
function useDaysShown(entries: readonly ActivityEntry[], shown: boolean) {
  const today = todayInIndia(apiNow());
  const newest = entries.at(0);
  const oldest = entries.at(-1);
  let sub: string | undefined;
  if (shown && newest !== undefined && oldest !== undefined) {
    const [first, last] = [indiaDate(oldest.at), indiaDate(newest.at)];
    if (first === last) sub = first === today ? copy.today : dayMonth(first);
    else sub = last === today ? copy.untilToday(dayMonth(first)) : copy.days(dayMonth(first), dayMonth(last));
  }
  useHeaderSub(sub);
}

/** The entries shown as a file, the sentence and what each row's details show. */
function DownloadCsv({ entries }: { entries: readonly ActivityEntry[] }) {
  const oldest = entries.at(-1);
  const newest = entries.at(0);
  if (oldest === undefined || newest === undefined) return null;
  return (
    <PageActions>
      <Button
        icon={ACTION_ICONS.download}
        variant="outline"
        size="small"
        onClick={() => {
          const file = copy.fileName(indiaDate(oldest.at), indiaDate(newest.at));
          saveFile(file, csvText(csvRows(entries)), "text/csv");
        }}
      >
        {copy.export}
      </Button>
    </PageActions>
  );
}

/**
 * The log as narrowed, a page at a time: older pages are added beneath as they are asked for. `empty` says there is
 * nothing, in words fit for where it stands; `page` says it is Activity's own, whose head says the days and offers
 * the file.
 */
function Log({ filters, empty = copy.empty, page = false }: { filters: Filters; empty?: string; page?: boolean }) {
  const [loaded, retry] = useLoad(useCallback(() => activityApi.activity(askedOf(filters)), [filters]));
  const [older, setOlder] = useState<Older | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderFailed, setOlderFailed] = useState<{ requestId: string | null } | null>(null);
  const entries = loaded.state === "loaded" ? [...loaded.value.entries, ...(older?.entries ?? [])] : [];
  useDaysShown(entries, page);
  if (loaded.state === "loading") return <PanelLoading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;

  const next = older === null ? loaded.value.next_cursor : older.next;
  const showOlder = async (cursor: string) => {
    setLoadingOlder(true);
    const answer = await activityApi.activity(askedOf(filters, cursor));
    setLoadingOlder(false);
    setOlderFailed(answer.ok ? null : { requestId: answer.requestId });
    if (!answer.ok) return;
    setOlder({ entries: [...(older?.entries ?? []), ...answer.body.entries], next: answer.body.next_cursor });
  };
  if (entries.length === 0 && !page) return <EmptyState look="panel" line={empty} />;
  if (entries.length === 0) {
    return (
      <Panel titleId="activity" title={copy.title}>
        <EmptyState look="panel" line={empty} />
      </Panel>
    );
  }
  return (
    <>
      {page && <DownloadCsv entries={entries} />}
      <Entries entries={entries} within={!page} />
      {olderFailed !== null && next !== null && (
        <PanelFailed onRetry={() => void showOlder(next)} requestId={olderFailed.requestId} />
      )}
      {next !== null && (
        <Button
          icon={ACTION_ICONS.chevronDown}
          variant="outline"
          size="small"
          className={page ? styles.older : styles.olderWithin}
          busy={loadingOlder}
          onClick={() => void showOlder(next)}
        >
          {loadingOlder ? copy.loadingOlder : copy.older}
        </Button>
      )}
    </>
  );
}

/** What was done on one client's record and by them, the latest first: their page's History tab. */
export function RecordActivity({ person }: { person: string }) {
  const filters = useMemo(() => ({ person }), [person]);
  return (
    <div className={styles.log}>
      <Log filters={filters} empty={copy.recordEmpty} />
    </div>
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
    <div className={styles.log}>
      <Toolbar label={copy.filters.label}>
        <DrawerButton icon={ACTION_ICONS.funnel} label={copy.filters.filter}>
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
        <Checkbox
          label={copy.filters.reads}
          checked={filters.reads === "include"}
          onChange={(event) => {
            apply({ ...filters, reads: event.target.checked ? "include" : undefined });
          }}
        />
      </Toolbar>
      <Log key={activityPath(filters)} filters={filters} page />
    </div>
  );
}
