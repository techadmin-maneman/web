// The way into a client's page. The board opens on a client and draws no way
// of finding one, so this is the console's own: any part of a name, or four
// digits or more of a number, sent in the request body, never in a path or a
// query string, so a number stays out of URLs, referrers and logs
// (src/routes/ops-clients.ts). The matches are listed by name, each with where
// the client stands and their next visit, so two of one name can be told apart.
//
// Every other page's header searches here too. The words and what they found
// are kept in the history entry, so Back from a client finds the results again;
// before any search, the clients opened this session are offered
// (lib/client-search.ts).

import { Button } from "@maneman/ui/Button";
import { indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { useCallback, useEffect, useState } from "react";
import { api, type ClientsFound } from "../api.ts";
import { OpsLink, Shell } from "../components/Shell.tsx";
import { clients } from "../content.ts";
import { keepSearch, keptSearch, recentClients, type KeptSearch } from "../lib/client-search.ts";
import { phoneWords } from "../lib/phone.ts";
import { clientPath } from "../route.ts";
import styles from "./clients.module.css";

const copy = clients.find;

/** What the last search answered, with the words it was for, or why it did not. */
type Finding =
  | { readonly step: "idle" }
  | { readonly step: "finding" }
  | { readonly step: "found"; readonly text: string; readonly found: ClientsFound }
  | { readonly step: "failed"; readonly code: string };

function findingOf(kept: KeptSearch | null): Finding {
  const found = kept?.found ?? null;
  return kept === null || found === null ? { step: "idle" } : { step: "found", text: kept.text, found };
}

/** "Fitted · Next visit Sat 20 Sep, 10:30 am". */
function standing(client: ClientsFound["clients"][number]): string {
  const next = client.next_visit;
  const visit = next === null ? copy.noVisit : copy.nextVisit(`${shortDate(indiaDate(next))}, ${indiaClock(next)}`);
  return `${clients.states[client.state]} · ${visit}`;
}

function Found({ text, found }: { text: string; found: ClientsFound }) {
  if (found.clients.length === 0) {
    return (
      <p className={styles.note} role="status">
        {copy.none(text)}
      </p>
    );
  }
  return (
    <section className={styles.found} aria-label={copy.found}>
      <ul className={styles.foundList}>
        {found.clients.map((client) => (
          <li className={styles.foundRow} key={client.id}>
            <span className={styles.foundWho}>
              <OpsLink className={styles.foundName} to={clientPath(client.id, "visits")}>
                {client.name}
              </OpsLink>
              <span className={styles.foundStanding}>{standing(client)}</span>
            </span>
            <span className={styles.foundMobile}>{phoneWords(client.mobile)}</span>
          </li>
        ))}
      </ul>
      {found.more && <p className={styles.note}>{copy.more}</p>}
    </section>
  );
}

function Recent() {
  const [recent] = useState(recentClients);
  if (recent.length === 0) return null;
  return (
    <section className={styles.found} aria-labelledby="recent-clients">
      <h2 className={styles.foundTitle} id="recent-clients">
        {copy.recent}
      </h2>
      <ul className={styles.foundList}>
        {recent.map((client) => (
          <li className={styles.foundRow} key={client.id}>
            <OpsLink className={styles.foundName} to={clientPath(client.id, "visits")}>
              {client.name}
            </OpsLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function FindClientScreen() {
  // A search another page's header sent here, or the one this entry found before Back came back to it.
  const [kept] = useState(keptSearch);
  const [text, setText] = useState(kept?.text ?? "");
  const [finding, setFinding] = useState<Finding>(() => findingOf(kept));

  const find = useCallback(async (typed: string) => {
    setFinding({ step: "finding" });
    const answer = await api.findClients(typed);
    if (!answer.ok) {
      setFinding({ step: "failed", code: answer.code });
      return;
    }
    setFinding({ step: "found", text: typed, found: answer.body });
    keepSearch({ text: typed, found: answer.body });
  }, []);

  useEffect(() => {
    if (kept !== null && kept.found === null) void find(kept.text);
  }, [kept, find]);

  return (
    <Shell section="/clients" title={clients.title} finder={false}>
      <form
        className={styles.find}
        onSubmit={(event) => {
          event.preventDefault();
          void find(text.trim());
        }}
      >
        <label className={styles.findLabel} htmlFor="find">
          {copy.label}
        </label>
        <input
          id="find"
          className={styles.findField}
          type="search"
          autoComplete="off"
          aria-describedby="find-hint"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
        <p className={styles.findHint} id="find-hint">
          {copy.hint}
        </p>
        <Button
          variant="primary"
          size="small"
          className={styles.primary}
          type="submit"
          disabled={finding.step === "finding" || text.trim() === ""}
        >
          {finding.step === "finding" ? copy.finding : copy.submit}
        </Button>
        {finding.step === "failed" && (
          <p className={styles.error} role="alert">
            {copy.errors[finding.code] ?? copy.errors.unknown}
          </p>
        )}
      </form>
      {finding.step === "found" && <Found text={finding.text} found={finding.found} />}
      {finding.step === "idle" && <Recent />}
    </Shell>
  );
}
