// The signed-in Care person's unanswered-lead alerts on the device they are on
// (docs/decisions/0323-the-unanswered-lead-alert.md): offered where the device can show them, they are not on yet, and
// the API can push; asked for only when they tap. The answer is said where the button was, and focus stays there.

import { ACTION_ICONS } from "@maneman/brand/action-icons";
import { Button } from "@maneman/ui/Button";
import { Note } from "@maneman/ui/Note";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import { care } from "../content/care.ts";
import { notificationsHere, turnOnLeadAlerts, type OnThisPhone } from "../lib/lead-push.ts";
import styles from "./care.module.css";

const copy = care.team.alerts;

export function PhoneAlerts() {
  const [here, setHere] = useState<OnThisPhone>(notificationsHere);
  const [key, setKey] = useState<string | null>(null);
  const [busy, once] = useOneAtATime();
  const spot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (here === "unsupported") return;
    api
      .waitingLeads()
      .then((answer) => {
        if (answer.ok) setKey(answer.body.push_key);
      })
      .catch(() => undefined);
  }, [here]);
  if (here === "unsupported" || key === null) return null;
  return (
    <div ref={spot} tabIndex={-1} className={styles.alerts}>
      {here === "on" || here === "blocked" || here === "failed" ? <Note role="status">{copy[here]}</Note> : null}
      {(here === "off" || here === "failed") && (
        <Button
          variant="outline"
          size="small"
          icon={ACTION_ICONS.bell}
          disabled={busy}
          onClick={() =>
            void once(async () => {
              setHere(await turnOnLeadAlerts(key));
              spot.current?.focus();
            })
          }
        >
          {copy.turnOn}
        </Button>
      )}
    </div>
  );
}
