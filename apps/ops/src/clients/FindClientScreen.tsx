// The way into a client's page. The board opens on a client and draws no way
// of finding one, so this is the console's own: any part of a name, or four
// digits or more of a number, sent in the request body, never in a path or a
// query string, so a number stays out of URLs, referrers and logs
// (src/routes/ops-clients.ts). The matches are listed by name, each a way to
// the client's page.

import { useState } from "react";
import { api, type ClientsFound } from "../api.ts";
import { OpsLink, Shell } from "../components/Shell.tsx";
import { clients } from "../content.ts";
import { phoneWords } from "../lib/phone.ts";
import styles from "./clients.module.css";

const copy = clients.find;

/** What the last search answered, with the words it was for, or why it did not. */
type Finding =
  | { readonly step: "idle" }
  | { readonly step: "finding" }
  | { readonly step: "found"; readonly text: string; readonly found: ClientsFound }
  | { readonly step: "failed"; readonly code: string };

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
            <OpsLink className={styles.foundName} to={`/clients/${client.id}`}>
              {client.name}
            </OpsLink>
            <span className={styles.foundMobile}>{phoneWords(client.mobile)}</span>
          </li>
        ))}
      </ul>
      {found.more && <p className={styles.note}>{copy.more}</p>}
    </section>
  );
}

export function FindClientScreen() {
  const [text, setText] = useState("");
  const [finding, setFinding] = useState<Finding>({ step: "idle" });

  const find = async (typed: string) => {
    setFinding({ step: "finding" });
    const answer = await api.findClients(typed);
    setFinding(answer.ok ? { step: "found", text: typed, found: answer.body } : { step: "failed", code: answer.code });
  };

  return (
    <Shell section="/clients" title={clients.title}>
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
        <button className={styles.primary} type="submit" disabled={finding.step === "finding" || text.trim() === ""}>
          {finding.step === "finding" ? copy.finding : copy.submit}
        </button>
        {finding.step === "failed" && (
          <p className={styles.error} role="alert">
            {copy.errors[finding.code] ?? copy.errors.unknown}
          </p>
        )}
      </form>
      {finding.step === "found" && <Found text={finding.text} found={finding.found} />}
    </Shell>
  );
}
