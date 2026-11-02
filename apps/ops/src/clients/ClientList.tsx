// Every client in the caller's cities, or the city chosen in the header (ADR 0225), beneath the search: the soonest
// next visit first, then those with none, newest first (GET /api/clients), each with what waits for them on Tasks.
// Where they stand and the page are kept in the address, so a list narrowed one way can be kept as a bookmark and sent
// to a colleague: "/clients?state=lead".

import { ToggleButton } from "@maneman/ui/ToggleButton";
import { Button } from "@maneman/ui/Button";
import { NoValue } from "@maneman/ui/NoValue";
import { textLinkLook } from "@maneman/ui/TextLink";
import { Toolbar } from "@maneman/ui/Toolbar";
import { Panel } from "@maneman/ui/Panel";
import { EmptyState } from "@maneman/ui/EmptyState";
import { rowRule, Table, type RuleTone } from "@maneman/ui/Table";
import { ListRow, ListRows, type EndTone } from "@maneman/ui/ListRow";
import { useIsPhone } from "../lib/media.ts";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaClock, indiaDate, shortDate, todayInIndia } from "@maneman/web-kit/dates";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { type ClientList as Listed, type ClientListQuery, type TaskGroup, type Tasks } from "../api.ts";
import { useHeaderSub } from "../frame/PageHead.tsx";
import { useAccess } from "../lib/access.ts";
import { dueRule } from "../lib/due.ts";
import { useTaskBoard } from "../lib/waiting.ts";
import { rupees } from "@maneman/web-kit/money";
import { OpsLink } from "../frame/Shell.tsx";
import { clients, tasks } from "../content.ts";
import { useCity } from "../lib/city.ts";
import { phoneWords } from "../lib/phone.ts";
import { clientPath } from "../route.ts";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import styles from "./client-list.module.css";
import { RowHead } from "@maneman/ui/RowHead";
import { clientsApi } from "./clients-api.ts";
import { apiNow } from "@maneman/web-kit/clock";

const copy = clients.list;

/** How many the API lists a page (src/domain/clients/client-list.ts). */
const CLIENTS_PER_PAGE = 50;
const STATES = ["lead", "fitted", "nothing_booked"] as const;

/** The list as the address narrows it, from its first page or the page it names; anything it would refuse is left out. */
function queryOf(search: string, paged = true): ClientListQuery {
  const asked = new URLSearchParams(search);
  const state = STATES.find((each) => each === asked.get("state"));
  const cursor = asked.get("cursor") ?? "";
  return {
    ...(state === undefined ? {} : { state }),
    ...(paged && /^[\w-]{1,200}$/.test(cursor) ? { cursor } : {}),
  };
}

/** The address of the list narrowed so, kept in this history entry without a reload. */
function keep(query: ClientListQuery): void {
  const asked = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) asked.set(name, value);
  const search = asked.toString();
  history.replaceState(history.state, "", search === "" ? location.pathname : `${location.pathname}?${search}`);
}

type Counts = NonNullable<Listed["counts"]>;

function Narrow({
  query,
  counts,
  onQuery,
}: {
  query: ClientListQuery;
  counts: Counts | null;
  onQuery: (query: ClientListQuery) => void;
}) {
  // A narrowing changed starts the list again from its first page.
  const choose = (value: string) => {
    onQuery(queryOf(value === "" ? "" : `?${new URLSearchParams({ state: value }).toString()}`));
  };
  return (
    <div className={styles.listStates} role="radiogroup" aria-label={copy.state}>
      {(["", ...STATES] as const).map((state) => (
        <ToggleButton
          key={state}
          asRadio
          filled
          pressed={(query.state ?? "") === state}
          count={counts?.[state === "" ? "all" : state]}
          onClick={() => {
            choose(state);
          }}
        >
          {state === "" ? tasks.filters.views.all : clients.states[state]}
        </ToggleButton>
      ))}
    </div>
  );
}

/** Their next visit, "Thu 24 Sep, 10:30 am"; under way, once one has begun; overdue, past its day; or none booked. */
function nextVisitOf(client: Listed["clients"][number], today: string): ReactNode {
  if (client.under_way) return copy.underWay;
  if (client.next_visit === null) return <NoValue />;
  const day = indiaDate(client.next_visit);
  if (day < today) return copy.overdue(shortDate(day));
  return `${shortDate(day)}, ${indiaClock(client.next_visit)}`;
}

/** The task waiting longest on a client, by when it falls due, from the board the navigation reads. */
interface Need {
  readonly group: TaskGroup["group"];
  readonly due: string;
}

type Needs = ReadonlyMap<string, Need>;

function needsOf(board: Tasks | null): Needs {
  const needs = new Map<string, { group: TaskGroup["group"]; due: string }>();
  for (const group of board?.groups ?? [])
    for (const task of group.tasks) {
      const person = task.person?.id;
      const was = person === undefined ? undefined : needs.get(person);
      if (person !== undefined && (was === undefined || task.due < was.due))
        needs.set(person, { group: group.group, due: task.due });
    }
  return needs;
}

/** Where they stand, and the package they are on beside it: "Fitted · Natural hair system". */
const stageOf = (client: Listed["clients"][number]): string =>
  client.package === null ? clients.states[client.state] : `${clients.states[client.state]} · ${client.package}`;

/** A next visit past its day and not yet begun. */
const isOverdue = (client: Listed["clients"][number], today: string): boolean =>
  !client.under_way && client.next_visit !== null && indiaDate(client.next_visit) < today;

/** A row's rule: an overdue visit in the error's tone, else how late their oldest task is, or brass for one open. */
function ruleOf(client: Listed["clients"][number], need: Need | undefined, now: Date): RuleTone | undefined {
  if (isOverdue(client, todayInIndia(now.getTime()))) return "error";
  return need === undefined ? undefined : (dueRule(need.due, now) ?? "attention");
}

/** A row's end on a phone: late in the error's red, a task in brass, a next visit muted. */
function endToneOf(rule: RuleTone | undefined, need: Need | undefined): EndTone {
  if (rule === "error") return "error";
  return need === undefined ? "muted" : "attention";
}

/** On a phone, a row each: their name over where they stand and their city, and what waits for them or when next. */
function PhoneRows({ listed, needs }: { listed: Listed; needs: Needs }) {
  const now = new Date(apiNow());
  return (
    <ListRows label={clients.title}>
      {listed.clients.map((client) => {
        const need = needs.get(client.id);
        const rule = ruleOf(client, need, now);
        return (
          <ListRow
            key={client.id}
            title={client.name}
            meta={[stageOf(client), ...(client.city === null ? [] : [client.city])].join(" · ")}
            end={need === undefined ? nextVisitOf(client, todayInIndia(now.getTime())) : tasks.groups[need.group]}
            endTone={endToneOf(rule, need)}
            rule={rule}
            to={clientPath(client.id, "visits")}
          />
        );
      })}
    </ListRows>
  );
}

function Rows({ listed, needs }: { listed: Listed; needs: Needs }) {
  const today = todayInIndia(apiNow());
  const now = new Date(apiNow());
  const phone = useIsPhone();
  if (listed.clients.length === 0) return <EmptyState look="panel" line={copy.none} />;
  if (phone) return <PhoneRows listed={listed} needs={needs} />;
  return (
    <div className={styles.listScroll}>
      <Table>
        <thead>
          <tr>
            <th scope="col">{copy.name}</th>
            <th scope="col">{copy.city}</th>
            <th scope="col">{copy.stage}</th>
            <th scope="col">{copy.nextVisit}</th>
            <th scope="col">{copy.needs}</th>
            <th scope="col" className={styles.listPaid}>
              {clients.glance.paid}
            </th>
          </tr>
        </thead>
        <tbody>
          {listed.clients.map((client) => {
            const need = needs.get(client.id);
            const rule = ruleOf(client, need, now);
            return (
              <tr key={client.id} className={rowRule(rule)}>
                <RowHead meta={phoneWords(client.mobile)}>
                  <OpsLink className={textLinkLook({ compact: true })} to={clientPath(client.id, "visits")}>
                    {client.name}
                  </OpsLink>
                </RowHead>
                <td>{client.city ?? <NoValue />}</td>
                <td>{stageOf(client)}</td>
                <td>{nextVisitOf(client, today)}</td>
                <td className={rule === "error" ? styles.listLate : styles.listNeed}>
                  {need === undefined ? null : tasks.groups[need.group]}
                </td>
                <td className={styles.listPaid}>{client.paid === 0 ? <NoValue /> : rupees(client.paid)}</td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}

/** The counts the first page gave, kept while later pages, which give none, are read. */
function useCounts(given: Counts | null): Counts | null {
  const [kept, setKept] = useState<Counts | null>(given);
  useEffect(() => {
    if (given !== null) setKept(given);
  }, [given]);
  return given ?? kept;
}

/** "51–100 of 4,603" where the total is known; "Page 2" otherwise. */
function pageWords(page: number, listed: Listed, total: number | undefined): string {
  if (total === undefined) return copy.page(page);
  const first = (page - 1) * CLIENTS_PER_PAGE + 1;
  return copy.range(first, first + listed.clients.length - 1, total);
}

/** The list asked for in a city: its status, the city, then its page, as the address once had them. */
function inCity(query: ClientListQuery, city: string | null): ClientListQuery {
  if (city === null) return query;
  const { cursor, ...narrowed } = query;
  return { ...narrowed, city, ...(cursor === undefined ? {} : { cursor }) };
}

interface ListProps {
  readonly search: ReactNode;
  readonly instead: ReactNode | null;
}

/**
 * The list for the city chosen in the header, drawn afresh when another is chosen: from the page the address names
 * the first time, and from the first page after that.
 */
export function ClientList(props: ListProps) {
  const { city } = useCity();
  const first = useRef(city);
  return <CityList key={city ?? ""} city={city} paged={city === first.current} {...props} />;
}

function CityList({ search, instead, city, paged }: ListProps & { city: string | null; paged: boolean }) {
  const [query, setQuery] = useState(() => {
    const opening = queryOf(location.search, paged);
    // Another city's list starts at its first page, and the address says so.
    if (!paged) keep(opening);
    return opening;
  });
  // The pages before this one, by their cursors, for Previous: the first page's is undefined. A list opened at a page
  // from its address has none, and its Previous goes to the first.
  const [trail, setTrail] = useState<readonly (string | undefined)[]>([]);
  const [loaded, retry] = useLoad(useCallback(() => clientsApi.clientList(inCity(query, city)), [query, city]));
  const counts = useCounts(loaded.state === "loaded" ? loaded.value.counts : null);
  const board = useTaskBoard(useAccess().mayCall("GET /api/tasks"));
  const needs = useMemo(() => needsOf(board), [board]);
  useHeaderSub(
    counts === null
      ? undefined
      : copy.sub(counts.all, counts.fitted, board === null || board.truncated ? null : needs.size),
  );
  const change = (next: ClientListQuery, earlier: readonly (string | undefined)[] = []) => {
    keep(next);
    setQuery(next);
    setTrail(earlier);
  };
  const at = (cursor: string | undefined): ClientListQuery => {
    const { cursor: _, ...first } = query;
    return cursor === undefined ? first : { ...first, cursor };
  };
  const later = query.cursor !== undefined;
  const page = later && trail.length === 0 ? null : trail.length + 1;
  return (
    <>
      <Toolbar label={copy.narrow}>
        {search}
        {instead === null && <Narrow query={query} counts={counts} onQuery={change} />}
      </Toolbar>
      <Panel titleId="all-clients" title={clients.title}>
        {instead}
        {instead === null && loaded.state === "loading" && <PanelLoading />}
        {instead === null && loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
        {instead === null && loaded.state === "loaded" && (
          <>
            <Rows listed={loaded.value} needs={needs} />
            {(later || loaded.value.next_cursor !== null) && (
              <div className={styles.listPages}>
                <Button
                  variant="outline"
                  size="small"
                  disabled={!later}
                  onClick={() => {
                    change(at(trail.at(-1)), trail.slice(0, -1));
                  }}
                >
                  {copy.previous}
                </Button>
                {page !== null && (
                  <span className={styles.listPage}>
                    {pageWords(page, loaded.value, counts?.[query.state ?? "all"])}
                  </span>
                )}
                <Button
                  variant="outline"
                  size="small"
                  disabled={loaded.value.next_cursor === null}
                  onClick={() => {
                    const next = loaded.value.next_cursor;
                    if (next !== null) change(at(next), [...trail, query.cursor]);
                  }}
                >
                  {copy.next}
                </Button>
              </div>
            )}
          </>
        )}
      </Panel>
    </>
  );
}
