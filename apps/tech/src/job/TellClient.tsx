// Navigate, Call and Message on the job (docs/prompts/tech-redesign.md, "Job"), each a tile. Message opens a sheet:
// pick the minutes, then "On my way, 20 min" or "Running 20 min late", sent to the client on WhatsApp from our number
// (docs/decisions/0145-technician-presets.md). Each goes once; what went shows beneath as "Sent: …". A client who
// takes no WhatsApp updates is called instead.

import { GLYPHS } from "@maneman/brand/icons";
import { Button, ButtonLink } from "@maneman/ui/Button";
import { Icon } from "@maneman/ui/Icon";
import { Sheet, SheetClose, SheetPanel } from "@maneman/ui/Sheet";
import { ToggleButton } from "@maneman/ui/ToggleButton";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useId, useState } from "react";
import { firstNameOf } from "@rules/lib/names.ts";
import type { Job } from "../api.ts";
import { job as copy } from "../content.ts";
import { callLink, wayTo } from "../lib/navigate.ts";
import { clock } from "../lib/when.ts";
import { queue, replay } from "../store/outbox.ts";
import styles from "./tell-client.module.css";

type Preset = "on_the_way" | "running_late";

/** What was sent, by preset: its words and when. */
type Sent = Readonly<Partial<Record<Preset, { readonly words: string; readonly at: string }>>>;

const MINUTES = [10, 20, 30, 45, 60] as const;

/** Whether the client can be sent a word from the job: not once the technician is at the door, nor after the close. */
const takesUpdates = (job: Job): boolean =>
  job.client?.whatsapp === true && job.progress.outcome === null && job.progress.checked_in_at === null;

function MessageSheet({
  job,
  who,
  sent,
  onSent,
  onClose,
}: {
  readonly job: Job;
  readonly who: string;
  readonly sent: Sent;
  readonly onSent: (preset: Preset, words: string) => void;
  readonly onClose: () => void;
}) {
  const titleId = useId();
  const [minutes, setMinutes] = useState<number>(20);
  const [busy, once] = useOneAtATime();
  const tell = (preset: Preset, words: string) =>
    once(async () => {
      await queue("update", job.id, { preset, minutes });
      void replay();
      onSent(preset, words);
    });
  const word = (preset: Preset, words: string) => {
    const at = sent[preset]?.at;
    return (
      <Button
        variant={preset === "on_the_way" ? "primary" : "outline"}
        size="action"
        className={styles.word}
        disabled={busy || at !== undefined}
        onClick={() => void tell(preset, words)}
      >
        {at === undefined ? words : copy.tell.sentAt(clock(at))}
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

/** Navigate, Call and Message, each a tile; Message opens the sheet of words to send, and says what went. */
export function TellClient({ job }: { job: Job }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<Sent>({});
  const client = job.client;
  const who = client === null ? null : firstNameOf(client.name);
  const message = client !== null && takesUpdates(job);
  const last = sent.running_late ?? sent.on_the_way;
  return (
    <>
      <div className={styles.actions}>
        {job.address !== null && (
          // A new tab, so a technician who has taken the route back still has the app open behind it.
          <ButtonLink
            variant="outline"
            size="action"
            className={styles.tile}
            href={wayTo(job.address)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon d={GLYPHS.navigate} size="md" />
            <span>{copy.navigate}</span>
          </ButtonLink>
        )}
        {client !== null && who !== null && (
          <ButtonLink
            variant="outline"
            size="action"
            className={styles.tile}
            href={callLink(client.mobile)}
            aria-label={copy.call(who)}
          >
            <Icon d={GLYPHS.phone} size="md" />
            <span>{copy.callShort}</span>
          </ButtonLink>
        )}
        {message && who !== null && (
          <Button
            variant="outline"
            size="action"
            className={styles.tile}
            aria-label={copy.message(who)}
            onClick={() => {
              setOpen(true);
            }}
          >
            <Icon d={GLYPHS.bubble} size="md" />
            <span>{copy.messageShort}</span>
          </Button>
        )}
      </div>
      {client !== null && who !== null && !client.whatsapp && job.progress.outcome === null && (
        <p className={styles.said}>{copy.tell.noWhatsApp(who)}</p>
      )}
      {last !== undefined && (
        <p className={styles.said} role="status">
          {copy.tell.sent(last.words)}
        </p>
      )}
      {open && who !== null && (
        <MessageSheet
          job={job}
          who={who}
          sent={sent}
          onSent={(preset: Preset, words: string) => {
            setSent((was) => ({ ...was, [preset]: { words, at: new Date().toISOString() } }));
            setOpen(false);
          }}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
