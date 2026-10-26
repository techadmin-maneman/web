// Every client in the caller's cities, beneath the search: the soonest next visit first, then those with none, newest
// first (GET /api/clients). Where they stand, the city and the page are kept in the address, so a list narrowed one way
// can be kept as a bookmark and sent to a colleague: "/clients?state=lead&city=Gurgaon".

import { Button } from "@maneman/ui/Button";
import { Field, Select } from "@maneman/ui/Field";
import { Note } from "@maneman/ui/Note";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaClock, indiaDate, shortDate, todayInIndia } from "@maneman/web-kit/dates";
import { useCallback, useState } from "react";
import { type ClientList as Listed, type ClientListQuery } from "../api.ts";
import { OpsLink } from "../components/Shell.tsx";
import { clients, tables } from "../content.ts";
import { phoneWords } from "../lib/phone.ts";
import { clientPath } from "../route.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import form from "../components/forms.module.css";
import shared from "./clients.module.css";
import styles from "./client-list.module.css";
import { RowHead } from "../components/RowHead.tsx";
import { clientsApi } from "./clients-api.ts";
import { apiNow } from "@maneman/web-kit/clock";

const copy = clients.list;
const STATES = ["lead", "fitted", "nothing_booked"] as const;

/** The list as the address narrows it; anything it would refuse is left out. */
function queryOf(search: string): ClientListQuery {
  const asked = new URLSearchParams(search);
  const state = STATES.find((each) => each === asked.get("state"));
  const city = asked.get("city")?.trim() ?? "";
  const cursor = asked.get("cursor") ?? "";
  return {
    ...(state === undefined ? {} : { state }),
    ...(city === "" ? {} : { city }),
    ...(/^[\w-]{1,200}$/.test(cursor) ? { cursor } : {}),
  };
}

/** The address of the list narrowed so, kept in this history entry without a reload. */
function keep(query: ClientListQuery): void {
  const asked = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) asked.set(name, value);
  const search = asked.toString();
  history.replaceState(history.state, "", search === "" ? location.pathname : `${location.pathname}?${search}`);
}

function Narrow({
  query,
  cities,
  onQuery,
}: {
  query: ClientListQuery;
  cities: readonly string[];
  onQuery: (query: ClientListQuery) => void;
}) {
  // A narrowing changed starts the list again from its first page.
  const choose = (name: "state" | "city") => (value: string) => {
    const state = name === "state" ? value : (query.state ?? "");
    const city = name === "city" ? value : (query.city ?? "");
    onQuery(queryOf(`?${new URLSearchParams({ state, city }).toString()}`));
  };
  return (
    <div className={styles.listNarrow}>
      <Field label={copy.state}>
        {(control) => (
          <Select
            {...control}
            value={query.state ?? ""}
            onChange={(event) => {
              choose("state")(event.target.value);
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
      <Field label={copy.city}>
        {(control) => (
          <Select
            {...control}
            value={query.city ?? ""}
            onChange={(event) => {
              choose("city")(event.target.value);
            }}
          >
            <option value="">{tables.allCities}</option>
            {cities.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </div>
  );
}

/** Their next visit, "Thu 24 Sep, 10:30 am"; under way, once one has begun; overdue, past its day; or none booked. */
function nextVisitOf(client: Listed["clients"][number], today: string): string {
  if (client.under_way) return copy.underWay;
  if (client.next_visit === null) return copy.noVisit;
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
                <OpsLink className={form.link} to={clientPath(client.id, "visits")}>
                  {client.name}
                </OpsLink>
              </RowHead>
              <td>{phoneWords(client.mobile)}</td>
              <td>{clients.states[client.state]}</td>
              <td>{client.city ?? copy.noCity}</td>
              <td>{nextVisitOf(client, todayInIndia(apiNow()))}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

export function ClientList() {
  const [query, setQuery] = useState(() => queryOf(location.search));
  // The pages before this one, by their cursors, for Previous: the first page's is undefined. A list opened at a page
  // from its address has none, and its Previous goes to the first.
  const [trail, setTrail] = useState<readonly (string | undefined)[]>([]);
  const [loaded, retry] = useLoad(useCallback(() => clientsApi.clientList(query), [query]));
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
    <section className={styles.list} aria-labelledby="all-clients">
      <h2 className={shared.foundTitle} id="all-clients">
        {copy.title}
      </h2>
      {loaded.state === "loading" && <Loading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {loaded.state === "loaded" && (
        <>
          <Narrow query={query} cities={loaded.value.cities} onQuery={change} />
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
    </section>
  );
}
