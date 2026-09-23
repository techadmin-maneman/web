// The way into a client's page. The board opens on a client and draws no way
// of finding one, so this is the console's own: a mobile number, sent in the
// request body, never in a path or a query string, so it stays out of URLs,
// referrers and logs (src/routes/ops-clients.ts).

import { useState } from "react";
import { api } from "../api.ts";
import { Shell } from "../components/Shell.tsx";
import { clients } from "../content.ts";
import { go } from "../route.ts";
import styles from "./clients.module.css";

export function FindClientScreen() {
  const [mobile, setMobile] = useState("");
  const [finding, setFinding] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const copy = clients.find;

  const find = async () => {
    setFinding(true);
    setRefused(null);
    const answer = await api.findClient(mobile.trim());
    if (answer.ok) go(`/clients/${answer.body.id}`);
    else {
      setRefused(answer.code);
      setFinding(false);
    }
  };

  return (
    <Shell section="/clients" title={clients.title}>
      <form
        className={styles.find}
        onSubmit={(event) => {
          event.preventDefault();
          void find();
        }}
      >
        <label className={styles.findLabel} htmlFor="mobile">
          {copy.label}
        </label>
        <input
          id="mobile"
          className={styles.findField}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          value={mobile}
          onChange={(event) => {
            setMobile(event.target.value);
          }}
        />
        <p className={styles.findHint}>{copy.hint}</p>
        <button className={styles.primary} type="submit" disabled={finding || mobile.trim() === ""}>
          {finding ? copy.finding : copy.submit}
        </button>
        {refused !== null && (
          <p className={styles.error} role="alert">
            {copy.errors[refused] ?? copy.errors.unknown}
          </p>
        )}
      </form>
    </Shell>
  );
}
