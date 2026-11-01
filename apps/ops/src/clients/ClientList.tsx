// Every client in the caller's cities, or the city chosen in the header (ADR 0225), beneath the search: the soonest
// next visit first, then those with none, newest first (GET /api/clients). Where they stand and the page are kept in
// the address, so a list narrowed one way can be kept as a bookmark and sent to a colleague: "/clients?state=lead".

import { Button } from "@maneman/ui/Button";
import { NoValue } from "@maneman/ui/NoValue";
import { textLinkLook } from "@maneman/ui/TextLink";
import { Toolbar } from "@maneman/ui/Toolbar";
import { Panel } from "@maneman/ui/Panel";
import { Badge, type BadgeTone } from "@maneman/ui/Badge";
import { Field, Select } from "@maneman/ui/Field";
import { Note } from "@maneman/ui/Note";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaClock, indiaDate, shortDate, todayInIndia } from "@maneman/web-kit/dates";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { type ClientList as Listed, type ClientListQuery } from "../api.ts";
import { OpsLink } from "../frame/Shell.tsx";
import { clients } from "../content.ts";
import { useCity } from "../lib/city.ts";
import { phoneWords } from "../lib/phone.ts";
import { clientPath } from "../route.ts";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import styles from "./client-list.module.css";
import { RowHead } from "@maneman/ui/RowHead";
import { clientsApi } from "./clients-api.ts";
import { apiNow } from "@maneman/web-kit/clock";

const copy = clients.list;
const STATES = ["lead", "fitted", "nothing_booked"] as const;

/** Fitted is done; Booked is under way; nothing booked is a client to win back, said plainly. */
const STATE_TONES: Readonly<Record<(typeof STATES)[number], BadgeTone>> = {
  fitted: "done",
  lead: "attention",
  nothing_booked: "neutral",
};

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

function Narrow({ query, onQuery }: { query: ClientListQuery; onQuery: (query: ClientListQuery) => void }) {
  // A narrowing changed starts the list again from its first page.
  const choose = (value: string) => {
    onQuery(queryOf(`?${new URLSearchParams({ state: value }).toString()}`));
  };
  return (
    <Field label={copy.state} labelHidden>
      {(control) => (
        <Select
          {...control}
          value={query.state ?? ""}
          onChange={(event) => {
            choose(event.target.value);
          }}
        >
          <option value="">{copy.anyState}</option>
          {STATES.map((state) => (
            <option key={state} value={state}>
              {clients.states[state]}
            </option>
          ))}
        </Select>
      )}
    </Field>
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

function Rows({ listed }: { listed: Listed }) {
  if (listed.clients.length === 0) return <Note>{copy.none}</Note>;
  return (
    <div className={styles.listScroll}>
      <Table controls>
        <thead>
          <tr>
            <th scope="col">{copy.name}</th>
            <th scope="col">{copy.mobile}</th>
            <th scope="col">{copy.state}</th>
            <th scope="col">{copy.city}</th>
            <th scope="col">{copy.nextVisit}</th>
          </tr>
        </thead>
        <tbody>
          {listed.clients.map((client) => (
            <tr key={client.id}>
              <RowHead>
                <OpsLink className={textLinkLook({ compact: true })} to={clientPath(client.id, "visits")}>
                  {client.name}
                </OpsLink>
              </RowHead>
              <td>{phoneWords(client.mobile)}</td>
              <td>
                <Badge tone={STATE_TONES[client.state]}>{clients.states[client.state]}</Badge>
              </td>
              <td>{client.city ?? <NoValue />}</td>
              <td>{nextVisitOf(client, todayInIndia(apiNow()))}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
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
    <Panel titleId="all-clients" title={copy.title}>
      <Toolbar label={copy.narrow} className={styles.listTools}>
        {search}
        {instead === null && loaded.state === "loaded" && <Narrow query={query} onQuery={change} />}
      </Toolbar>
      {instead}
      {instead === null && loaded.state === "loading" && <PanelLoading />}
      {instead === null && loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {instead === null && loaded.state === "loaded" && (
        <>
          <Rows listed={loaded.value} />
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
              {page !== null && <span className={styles.listPage}>{copy.page(page)}</span>}
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
  );
}
