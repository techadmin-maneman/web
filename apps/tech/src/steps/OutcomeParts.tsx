// The outcome's result and its summary (docs/prompts/tech-redesign.md, "Outcome"; ./Outcome.tsx): Done or Partly done
// as radio rows under their heading, a consultation's question in the same form, and what the close sends.

import { ChoiceGroup, Radio } from "@maneman/ui/Field";
import { SectionHead } from "@maneman/ui/SectionHead";
import type { Job } from "../api.ts";
import { badges, steps as copy } from "../content.ts";
import { IN_A_SET } from "../lib/sets.ts";
import { useOutbox } from "../lib/useOutbox.ts";
import shared from "./steps.module.css";
import styles from "./outcome.module.css";

/** The result, Done or Partly done, as radio rows under its heading (docs/prompts/tech-redesign.md, "Outcome"). */
export function Result(props: { chosen: "done" | "partial" | null; onChoose: (value: "done" | "partial") => void }) {
  const options = [
    ["done", copy.outcome.done],
    ["partial", copy.outcome.partial],
  ] as const;
  return (
    <ChoiceGroup legend={copy.outcome.result} legendLook="title" ruled className={styles.result}>
      {options.map(([value, label]) => (
        <Radio
          key={value}
          name="result"
          label={label}
          checked={props.chosen === value}
          onChange={() => {
            props.onChoose(value);
          }}
        />
      ))}
    </ChoiceGroup>
  );
}

/** A consultation's one question, as the prototype asks it at once: "Going ahead with a fit?", Yes or Not now. */
export function GoingAheadRows(props: { answer: boolean | null; onAnswer: (value: boolean) => void }) {
  const options = [
    [true, copy.outcome.yes],
    [false, copy.outcome.notNow],
  ] as const;
  return (
    <ChoiceGroup legend={copy.outcome.goingAhead} legendLook="title" ruled className={styles.result}>
      {options.map(([value, label]) => (
        <Radio
          key={String(value)}
          name="going-ahead"
          label={label}
          checked={props.answer === value}
          onChange={() => {
            props.onAnswer(value);
          }}
        />
      ))}
    </ChoiceGroup>
  );
}

/** What the close sends, before it goes: whose visit, how it is paid, and the photographs and where they stand. */
export function Summary({ job }: { job: Job }) {
  const { frames } = useOutbox();
  const waiting = frames.filter((frame) => frame.job_id === job.id).length;
  const sets = job.progress.steps_done.filter((step) => step === "before_photos" || step === "after_photos").length;
  const photos =
    waiting > 0 ? copy.outcome.uploading(sets * IN_A_SET + waiting) : copy.outcome.photosSent(sets * IN_A_SET);
  const rows = [
    [copy.outcome.client, job.client?.name ?? null],
    [copy.outcome.payment, badges[job.badge]],
    [copy.outcome.photos, photos],
  ] as const;
  return (
    <section aria-labelledby="outcome-summary">
      <SectionHead id="outcome-summary" size="list" title={copy.outcome.summary} className={styles.summaryHead} />
      <dl className={shared.rows}>
        {rows.map(([name, value]) =>
          value === null ? null : (
            <div key={name} className={shared.row}>
              <dt className={shared.rowKey}>{name}</dt>
              <dd className={shared.rowValue}>{value}</dd>
            </div>
          ),
        )}
      </dl>
    </section>
  );
}
