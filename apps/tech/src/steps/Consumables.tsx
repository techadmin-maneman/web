// Board B3, step 3: what was used, with quantities. Steppers rather than number
// fields, so a gloved hand never opens a keyboard.
//
// The names are the app's: FSM holds no consumables catalogue, so the API takes
// whatever the technician names and keeps it as he entered it
// (src/config/job-sheet.ts, docs/open-points.md item 13). The four here are the
// board's own, a placeholder until the owner builds the list.
//
// Each count is said as it changes, and each stepper names the count it
// changes, so a screen reader hears "Tape strips: 2" rather than nothing.

import { ICONS } from "@maneman/brand/icons";
import { Icon } from "@maneman/ui/Icon";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { useId, useState } from "react";
import { job as jobCopy, steps as copy } from "../content.ts";
import { STEPPER_STROKE } from "../icons.ts";
import { Failed, Loading } from "../states/States.tsx";
import { StepFrame } from "./StepFrame.tsx";
import { useStep } from "./useStep.ts";
import styles from "./steps.module.css";

const ITEMS = copy.consumables.items;
const MOST = 99;

export function Consumables({ id }: { id: string }) {
  const { loaded, retry, refused, finish, back } = useStep(id, "consumables");
  const [counts, setCounts] = useState<readonly number[]>(() => ITEMS.map(() => 0));
  const countId = useId();

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <Failed message={jobCopy.failed} retry={jobCopy.retry} onRetry={retry} />;

  const change = (index: number, by: number) => {
    setCounts((already) =>
      already.map((count, place) => (place === index ? Math.min(MOST, Math.max(0, count + by)) : count)),
    );
  };
  // Nothing used is an answer too: the step sends an empty list rather than being skipped.
  const used = ITEMS.flatMap((name, index) => {
    const quantity = counts[index] ?? 0;
    return quantity > 0 ? [{ name, quantity }] : [];
  });

  return (
    <StepFrame
      title={copy.titles.consumables}
      action={copy.next}
      ready
      notice={refused === null ? null : copy.corrected.other}
      onBack={back}
      onAction={() => void finish({ items: used })}
    >
      <ul className={styles.list}>
        {ITEMS.map((name, index) => {
          const count = counts[index] ?? 0;
          const said = `${countId}-${String(index)}`;
          return (
            <li className={styles.count} key={name}>
              <span className={styles.countLabel}>{name}</span>
              <span className={styles.stepper}>
                <button
                  className={styles.step}
                  type="button"
                  aria-label={copy.consumables.less(name)}
                  aria-describedby={said}
                  onClick={() => {
                    change(index, -1);
                  }}
                >
                  <Icon d={ICONS.minus} size={20} stroke={STEPPER_STROKE} />
                </button>
                <span className={styles.number} aria-hidden="true">
                  {count}
                </span>
                <button
                  className={styles.step}
                  type="button"
                  aria-label={copy.consumables.more(name)}
                  aria-describedby={said}
                  onClick={() => {
                    change(index, 1);
                  }}
                >
                  <Icon d={ICONS.plus} size={20} stroke={STEPPER_STROKE} />
                </button>
                <VisuallyHidden id={said} role="status">
                  {copy.consumables.count(name, count)}
                </VisuallyHidden>
              </span>
            </li>
          );
        })}
      </ul>
      {used.length === 0 && <p className={styles.note}>{copy.consumables.none}</p>}
    </StepFrame>
  );
}
