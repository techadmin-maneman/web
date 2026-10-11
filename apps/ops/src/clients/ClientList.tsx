// Every client in the caller's cities, beneath the search: the soonest next visit first, then those with none, newest
// first (GET /api/clients). Where they stand, the city and the page are kept in the address, so a list narrowed one way
// can be kept as a bookmark and sent to a colleague: "/clients?state=lead&city=Gurgaon".

import { Button } from "@maneman/ui/Button";
import { Field, Select } from "@maneman/ui/Field";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { useCallback, useState } from "react";
import { api, type ClientList as Listed, type ClientListQuery } from "../api.ts";
import { OpsLink } from "../components/Shell.tsx";
import { clients } from "../content.ts";
import { phoneWords } from "../lib/phone.ts";
import { clientPath } from "../route.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import form from "../components/forms.module.css";
import styles from "./clients.module.css";

const copy = clients.list;
const STATES = ["lead", "fitted", "nothing_booked"] as const;

/** The list as the address narrows it; anything it would refuse is left out. */
function queryOf(search: string): ClientListQuery {
  const asked = new URLSearchParams(search);
  const state = STATES.find((each) => each === asked.get("state"));
  const city = asked.get("city")?.trim() ?? "";
  const page = Number(asked.get("page") ?? "0");
  return {
    ...(state === undefined ? {} : { state }),
    ...(city === "" ? {} : { city }),
    ...(Number.isInteger(page) && page > 0 ? { page } : {}),
  };
}

/** The address of the list narrowed so, kept in this history entry without a reload. */
function keep(query: ClientListQuery): void {
  const asked = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) asked.set(name, String(value));
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
            <option value="">{copy.anyCity}</option>
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

function Rows({ listed }: { listed: Listed }) {
  if (listed.clients.length === 0) return <p className={form.note}>{copy.none}</p>;
  return (
    <div className={styles.listScroll}>
      <Table className={form.table}>
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
              <th scope="row" className={form.rowHead}>
                <OpsLink className={form.link} to={clientPath(client.id, "visits")}>
                  {client.name}
                </OpsLink>
              </th>
              <td>{phoneWords(client.mobile)}</td>
              <td>{clients.states[client.state]}</td>
              <td>{client.city ?? copy.noCity}</td>
              <td>
                {client.next_visit === null
                  ? copy.noVisit
                  : `${shortDate(indiaDate(client.next_visit))}, ${indiaClock(client.next_visit)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

export function ClientList() {
  const [query, setQuery] = useState(() => queryOf(location.search));
  const [loaded, retry] = useLoad(useCallback(() => api.clientList(query), [query]));
  const change = (next: ClientListQuery) => {
    keep(next);
    setQuery(next);
  };
  const page = query.page ?? 0;
  return (
    <section className={styles.list} aria-labelledby="all-clients">
      <h2 className={styles.foundTitle} id="all-clients">
        {copy.title}
      </h2>
      {loaded.state === "loading" && <Loading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {loaded.state === "loaded" && (
        <>
          <Narrow query={query} cities={loaded.value.cities} onQuery={change} />
          <Rows listed={loaded.value} />
          {(page > 0 || loaded.value.more) && (
            <div className={styles.listPages}>
              <Button
                variant="outline"
                size="small"
                disabled={page === 0}
                onClick={() => {
                  change({ ...query, page: page - 1 });
                }}
              >
                {copy.previous}
              </Button>
              <span className={styles.listPage}>{copy.page(page + 1)}</span>
              <Button
                variant="outline"
                size="small"
                disabled={!loaded.value.more}
                onClick={() => {
                  change({ ...query, page: page + 1 });
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
