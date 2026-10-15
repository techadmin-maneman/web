// Step 3: what was used, with quantities. Steppers rather than number
// fields, so a gloved hand never opens a keyboard.
//
// The consumables are ops', set in the console and read with the job, which the
// phone keeps for a basement (docs/decisions/0087-consumables-and-stock.md). A
// stepper stands for each one the visit's service is expected to use, already
// at what it expects; "Add another" gives a stepper for any other one. The step
// sends each by its code, and "none used" is an answer too: an empty list.
//
// Each count is said as it changes, and each stepper names the count it
// changes, so a screen reader hears "Tape strips: 2" rather than nothing.

import { IconButton } from "@maneman/ui/IconButton";
import { ICONS } from "@maneman/brand/icons";
import { Button } from "@maneman/ui/Button";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { useId, useState } from "react";
import type { EventBody, Job } from "../api.ts";
import { job as jobCopy, steps as copy } from "../content.ts";
import { Failed, Loading } from "../states/States.tsx";
import type { Queued } from "../store/outbox.ts";
import { StepFrame } from "./StepFrame.tsx";
import { useStep } from "./useStep.ts";
import shared from "./steps.module.css";
import styles from "./consumables.module.css";

type Offered = Job["consumables"][number];

/** The stepper stops here, as the API does. */
const MOST = 999;

/** What a refused step sent, by code, so the technician corrects it rather than counting again. */
function sentBefore(refused: Queued | null): Map<string, number> | null {
  const items = (refused?.body as { items?: unknown } | null | undefined)?.items;
  if (!Array.isArray(items)) return null;
  return new Map(
    items.flatMap((item: unknown) => {
      const line = item as { code?: unknown; quantity?: unknown };
      return typeof line.code === "string" && typeof line.quantity === "number" ? [[line.code, line.quantity]] : [];
    }),
  );
}

function Stepper({
  consumable,
  count,
  onChange,
}: {
  consumable: Offered;
  count: number;
  onChange: (count: number) => void;
}) {
  const said = useId();
  const { name } = consumable;
  const change = (by: number) => {
    onChange(Math.min(MOST, Math.max(0, count + by)));
  };
  return (
    <li className={shared.count}>
      <span className={shared.countLabel}>
        {name}
        <span className={shared.countUnit}>{copy.consumables.unit(consumable.unit, consumable.expected)}</span>
      </span>
      <span className={shared.stepper}>
        <IconButton
          edged
          className={styles.step}
          d={ICONS.minus}
          size="md"
          weight="heavy"
          label={copy.consumables.less(name)}
          aria-describedby={said}
          onClick={() => {
            change(-1);
          }}
        />
        <span className={shared.number} aria-hidden="true">
          {count}
        </span>
        <IconButton
          edged
          className={styles.step}
          d={ICONS.plus}
          size="md"
          weight="heavy"
          label={copy.consumables.more(name)}
          aria-describedby={said}
          onClick={() => {
            change(1);
          }}
        />
        <VisuallyHidden id={said} role="status">
          {copy.consumables.count(name, count)}
        </VisuallyHidden>
      </span>
    </li>
  );
}

/** What else the kit holds, each one tap to add to the visit's use. */
function Picks({
  others,
  onPick,
}: {
  others: readonly { readonly code: string; readonly name: string }[];
  onPick: (code: string) => void;
}) {
  return (
    <ul className={shared.picks}>
      {others.map((each) => (
        <li key={each.code}>
          <Button
            variant="outlineOnInk"
            size="control"
            className={shared.pick}
            aria-label={copy.consumables.addOne(each.name)}
            onClick={() => {
              onPick(each.code);
            }}
          >
            {each.name}
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** The step once the job is in hand: its steppers start from the job, so they are made with it. */
function Counting({
  job,
  refused,
  onFinish,
  onBack,
}: {
  job: Job;
  refused: Queued | null;
  onFinish: (body: EventBody<"consumables">) => void;
  onBack: () => void;
}) {
  const offered = job.consumables;
  const before = sentBefore(refused);
  const [counts, setCounts] = useState<ReadonlyMap<string, number>>(
    () => before ?? new Map(offered.map((each) => [each.code, each.expected])),
  );
  const [shown, setShown] = useState<readonly string[]>(() =>
    offered.filter((each) => each.expected > 0 || (before?.get(each.code) ?? 0) > 0).map((each) => each.code),
  );
  const [adding, setAdding] = useState(false);

  const others = offered.filter((each) => !shown.includes(each.code));
  const used = shown.flatMap((code) => {
    const quantity = counts.get(code) ?? 0;
    return quantity > 0 ? [{ code, quantity }] : [];
  });

  return (
    <StepFrame
      title={copy.titles.consumables}
      action={copy.next}
      ready
      notice={refused === null ? null : copy.corrected.other}
      onBack={onBack}
      onAction={() => {
        onFinish({ items: used });
      }}
    >
      <ul className={shared.list}>
        {shown.flatMap((code) => {
          const consumable = offered.find((each) => each.code === code);
          if (consumable === undefined) return [];
          return [
            <Stepper
              key={code}
              consumable={consumable}
              count={counts.get(code) ?? 0}
              onChange={(count) => {
                setCounts(new Map(counts).set(code, count));
              }}
            />,
          ];
        })}
      </ul>
      {offered.length === 0 && <p className={shared.note}>{copy.consumables.nothingOffered}</p>}
      {others.length > 0 && (
        <div className={shared.field}>
          <Button
            variant="outlineOnInk"
            size="control"
            className={shared.second}
            aria-expanded={adding}
            onClick={() => {
              setAdding(!adding);
            }}
          >
            {copy.consumables.add}
          </Button>
          {adding && (
            <Picks
              others={others}
              onPick={(code) => {
                setShown([...shown, code]);
                setCounts(new Map(counts).set(code, Math.max(1, counts.get(code) ?? 0)));
                setAdding(false);
              }}
            />
          )}
        </div>
      )}
      {used.length === 0 && <p className={shared.note}>{copy.consumables.none}</p>}
    </StepFrame>
  );
}

export function Consumables({ id }: { id: string }) {
  const { loaded, retry, refused, finish, back } = useStep(id, "consumables");

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") {
    return <Failed message={jobCopy.failed} retry={jobCopy.retry} onRetry={retry} requestId={loaded.requestId} />;
  }
  return <Counting job={loaded.value} refused={refused} onFinish={(body) => void finish(body)} onBack={back} />;
}
