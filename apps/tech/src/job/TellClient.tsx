// The technician's word to the client from the job card (docs/decisions/0145-technician-presets.md): on the way or
// running late, sent from our number through the outbox, so a word tapped without signal goes when the phone finds
// it. The words sit in a sheet behind one button, so the card stays short. Once the technician has arrived the client
// hears so on their own (the arrival message), and the button goes. A client who takes no WhatsApp messages about
// their visits is called instead.

import { Button } from "@maneman/ui/Button";
import { Sheet, SheetClose, SheetPanel } from "@maneman/ui/Sheet";
import { ToggleButton } from "@maneman/ui/ToggleButton";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useId, useState } from "react";
import type { Job } from "../api.ts";
import { job as copy } from "../content.ts";
import { firstNameOf } from "@rules/lib/names.ts";
import { clock } from "../lib/when.ts";
import { queue, replay } from "../store/outbox.ts";
import styles from "./tell-client.module.css";

type Preset = "on_the_way" | "running_late";

const MINUTES = [10, 20, 30, 45, 60] as const;

function Words({
  who,
  sent,
  busy,
  onTell,
  onClose,
}: {
  who: string;
  sent: Readonly<Partial<Record<Preset, string>>>;
  busy: boolean;
  onTell: (preset: Preset, minutes: number) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const [minutes, setMinutes] = useState<number>(20);
  const word = (preset: Preset, label: string) => {
    const at = sent[preset];
    return (
      <Button
        variant="outlineOnInk"
        size="action"
        className={styles.word}
        disabled={busy || at !== undefined}
        onClick={() => {
          onTell(preset, minutes);
        }}
      >
        {at === undefined ? label : copy.tell.sentAt(clock(at))}
      </Button>
    );
  };
  return (
    <Sheet labelledBy={titleId} rises={false} onClose={onClose}>
      <SheetClose quiet onClose={onClose}>
        {copy.tell.close}
      </SheetClose>
      <SheetPanel className={styles.panel}>
        <h2 className={styles.title} id={titleId}>
          {copy.tell.title(who)}
        </h2>
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
        {word("on_the_way", copy.tell.onTheWay(minutes))}
        {word("running_late", copy.tell.late(minutes))}
        <p className={styles.note}>{copy.tell.fromUs}</p>
      </SheetPanel>
    </Sheet>
  );
}

export function TellClient({ job }: { job: Job }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<Partial<Record<Preset, string>>>({});
  const [busy, once] = useOneAtATime();
  const client = job.client;
  if (client === null || job.progress.outcome !== null || job.progress.checked_in_at !== null) return null;
  const who = firstNameOf(client.name);
  if (!client.whatsapp) return <p className={styles.noWhatsApp}>{copy.tell.noWhatsApp(who)}</p>;

  const tell = (preset: Preset, minutes: number) =>
    once(async () => {
      await queue("update", job.id, { preset, minutes });
      void replay();
      setSent((was) => ({ ...was, [preset]: new Date().toISOString() }));
      setOpen(false);
    });

  const last = sent.running_late ?? sent.on_the_way;
  return (
    <>
      <Button
        variant="outlineOnInk"
        size="control"
        className={styles.open}
        onClick={() => {
          setOpen(true);
        }}
      >
        {copy.tell.open(who)}
      </Button>
      {last !== undefined && (
        <p className={styles.said} role="status">
          {copy.tell.sent(who, clock(last))}
        </p>
      )}
      {open && (
        <Words
          who={who}
          sent={sent}
          busy={busy}
          onTell={(preset, minutes) => void tell(preset, minutes)}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
