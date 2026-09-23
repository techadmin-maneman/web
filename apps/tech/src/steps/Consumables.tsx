// Board B3, step 3: what was used, with quantities. Steppers rather than number
// fields, so a gloved hand never opens a keyboard.
//
// The names are the app's: FSM holds no consumables catalogue, so the API takes
// whatever the technician names and keeps it as he entered it
// (src/config/job-sheet.ts, docs/open-points.md item 13). The four here are the
// board's own, a placeholder until the owner builds the list.

import { useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { job as jobCopy, steps as copy } from "../content.ts";
import { MINUS, PLUS } from "../icons.ts";
import { Failed, Loading } from "../states/States.tsx";
import { StepFrame } from "./StepFrame.tsx";
import { useStep } from "./useStep.ts";
import styles from "./steps.module.css";

const ITEMS = copy.consumables.items;
const MOST = 99;

export function Consumables({ id }: { id: string }) {
  const { loaded, retry, finish, back } = useStep(id, "consumables");
  const [counts, setCounts] = useState<readonly number[]>(() => ITEMS.map(() => 0));

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <Failed message={jobCopy.failed} retry={jobCopy.retry} onRetry={retry} />;

  const change = (index: number, by: number) => {
    setCounts((already) =>
      already.map((count, at_) => (at_ === index ? Math.min(MOST, Math.max(0, count + by)) : count)),
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
      onBack={back}
      onAction={() => void finish({ items: used })}
    >
      <ul className={styles.list}>
        {ITEMS.map((name, index) => (
          <li className={styles.count} key={name}>
            <span className={styles.countLabel}>{name}</span>
            <span className={styles.stepper}>
              <button
                className={styles.step}
                type="button"
                aria-label={copy.consumables.less(name)}
                onClick={() => {
                  change(index, -1);
                }}
              >
                <Icon d={MINUS} size={20} />
              </button>
              <span className={styles.number}>{counts[index] ?? 0}</span>
              <button
                className={styles.step}
                type="button"
                aria-label={copy.consumables.more(name)}
                onClick={() => {
                  change(index, 1);
                }}
              >
                <Icon d={PLUS} size={20} />
              </button>
            </span>
          </li>
        ))}
      </ul>
      {used.length === 0 && <p className={styles.note}>{copy.consumables.none}</p>}
    </StepFrame>
  );
}
