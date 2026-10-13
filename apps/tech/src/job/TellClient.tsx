// The technician's word to the client from the job card (docs/decisions/0145-technician-presets.md): on the way, at
// the gate, or running late, sent from our number through the outbox, so a word tapped without signal goes when the
// phone finds it. A client who takes no WhatsApp messages about their visits is called instead.

import { Button } from "@maneman/ui/Button";
import { ToggleButton } from "@maneman/ui/ToggleButton";
import { useState } from "react";
import type { Job } from "../api.ts";
import { job as copy } from "../content.ts";
import { firstNameOf } from "@rules/lib/names.ts";
import { queue, replay } from "../store/outbox.ts";
import styles from "./job.module.css";

type Preset = "on_the_way" | "at_gate" | "running_late";

const MINUTES = [10, 20, 30, 45, 60] as const;

export function TellClient({ job }: { job: Job }) {
  const [minutes, setMinutes] = useState<number>(20);
  const [sent, setSent] = useState<Preset | null>(null);
  const client = job.client;
  if (client === null || job.progress.outcome !== null) return null;
  const who = firstNameOf(client.name);
  if (!client.whatsapp) return <p className={styles.access}>{copy.tell.noWhatsApp(who)}</p>;
  const tell = async (preset: Preset) => {
    await queue("update", job.id, { preset, minutes: preset === "at_gate" ? null : minutes });
    void replay();
    setSent(preset);
  };
  return (
    <section className={styles.tell} aria-label={copy.tell.title(who)}>
      <p className={styles.landmarkLabel}>{copy.tell.title(who)}</p>
      <div className={styles.minutes} role="group" aria-label={copy.tell.minutes}>
        {MINUTES.map((each) => (
          <ToggleButton
            key={each}
            onInk
            className={styles.minute}
            pressed={each === minutes}
            onClick={() => {
              setMinutes(each);
            }}
          >
            {copy.tell.minute(each)}
          </ToggleButton>
        ))}
      </div>
      <div className={styles.reach}>
        <Button variant="outlineOnInk" size="control" onClick={() => void tell("on_the_way")}>
          {copy.tell.onTheWay(minutes)}
        </Button>
        <Button variant="outlineOnInk" size="control" onClick={() => void tell("running_late")}>
          {copy.tell.late(minutes)}
        </Button>
        <Button variant="outlineOnInk" size="control" onClick={() => void tell("at_gate")}>
          {copy.tell.atGate}
        </Button>
      </div>
      {sent !== null && (
        <p className={styles.access} role="status">
          {copy.tell.sent(who)}
        </p>
      )}
    </section>
  );
}
