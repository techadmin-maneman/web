// A technician's SOS on every console screen (docs/decisions/0248-safety.md): a red banner for each not yet handled,
// oldest first, read again every half minute, with whose it is, the visit, when, a map while there is a position, and
// whether they said they are safe. Operations mark one handled, which takes it off.

import { Button, ButtonLink } from "@maneman/ui/Button";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { indiaClock } from "@maneman/web-kit/dates";
import { useCallback, useEffect, useState } from "react";
import { mapLink } from "@rules/policy/safety.ts";
import { api, type OpenSos } from "../api.ts";
import { shell } from "../content/shell.ts";
import { useAccess } from "../lib/access.ts";
import styles from "./sos-banner.module.css";

const copy = shell.sos;

/** How often the banner asks again: an SOS must reach a screen left open within the minute. */
const READ_EVERY_MS = 30_000;

function OneSos({ sos, mayHandle, onHandled }: { sos: OpenSos; mayHandle: boolean; onHandled: () => void }) {
  const [busy, once] = useOneAtATime();
  const handle = () =>
    once(async () => {
      const answer = await api.sosHandled(sos.id);
      if (answer.ok) onHandled();
    });
  return (
    <div className={styles.sos} role="alert">
      <div className={styles.what}>
        <p className={styles.title}>{copy.title(sos.technician.name, indiaClock(sos.sent_at))}</p>
        <p className={styles.line}>
          {sos.visit === null ? copy.noVisit : copy.visit(sos.visit.client_name, indiaClock(sos.visit.starts_at))}
          {" · "}
          {sos.safe_at === null ? copy.call : copy.safe(indiaClock(sos.safe_at))}
        </p>
      </div>
      <div className={styles.actions}>
        {sos.position === null ? (
          <span className={styles.line}>{copy.noMap}</span>
        ) : (
          <ButtonLink
            variant="outline"
            size="small"
            href={mapLink(sos.position)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {copy.map(indiaClock(sos.position.at))}
          </ButtonLink>
        )}
        {mayHandle && (
          <Button variant="primary" size="small" busy={busy} disabled={busy} onClick={() => void handle()}>
            {copy.handled}
          </Button>
        )}
      </div>
    </div>
  );
}

export function SosBanner() {
  const access = useAccess();
  const mayRead = access.mayCall("GET /api/sos");
  const mayHandle = access.mayCall("POST /api/sos/{id}/handled");
  const [open, setOpen] = useState<readonly OpenSos[]>([]);
  const read = useCallback(async () => {
    const answer = await api.openSos();
    if (answer.ok) setOpen(answer.body.open);
  }, []);
  useEffect(() => {
    // Only for those it is shown to: national Operations.
    if (!mayRead) return undefined;
    const ask = () => {
      read().catch(() => undefined);
    };
    ask();
    const timer = setInterval(ask, READ_EVERY_MS);
    return () => {
      clearInterval(timer);
    };
  }, [read, mayRead]);
  if (open.length === 0) return null;
  return (
    <div className={styles.banner}>
      {open.map((sos) => (
        <OneSos key={sos.id} sos={sos} mayHandle={mayHandle} onHandled={() => void read()} />
      ))}
    </div>
  );
}
