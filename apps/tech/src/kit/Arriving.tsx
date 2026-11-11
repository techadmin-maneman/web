// The top-ups on their way to the kit (docs/decisions/0164-the-kit-screen.md; docs/prompts/tech-redesign.md, "Kit"):
// each received once in hand, a hair system's pieces scanned one by one, the rest still to come or reported missing.

import { amountOf } from "@maneman/web-kit/figures";
import { indiaDate } from "@maneman/web-kit/dates";
import { Button } from "@maneman/ui/Button";
import { ProgressLine } from "@maneman/ui/Progress";
import { ScanField } from "@maneman/ui/ScanField";
import { SectionHead } from "@maneman/ui/SectionHead";
import { ToggleButton } from "@maneman/ui/ToggleButton";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useState } from "react";
import { api, type Kit } from "../api.ts";
import { kit as copy, steps } from "../content.ts";
import { dayMonth } from "../lib/when.ts";
import { NotDone, type Problem } from "./NotDone.tsx";
import styles from "./kit.module.css";

type Coming = Kit["coming"][number];

/** Whether the pieces of a top-up not scanned are still to come, as they are unless the technician says otherwise. */
function RestOf({
  count,
  rest,
  onRest,
}: {
  readonly count: number;
  readonly rest: "on_its_way" | "missing";
  readonly onRest: (rest: "on_its_way" | "missing") => void;
}) {
  const choices = [
    ["on_its_way", copy.coming.stillToCome],
    ["missing", copy.coming.missing],
  ] as const;
  return (
    <div className={styles.buttons} role="group" aria-label={copy.coming.rest(count)}>
      <p className={styles.note}>{copy.coming.rest(count)}</p>
      {choices.map(([value, label]) => (
        <ToggleButton
          key={value}
          pressed={rest === value}
          onClick={() => {
            onRest(value);
          }}
        >
          {label}
        </ToggleButton>
      ))}
    </div>
  );
}

/** One top-up on its way: received whole, or of a hair system the pieces scanned, the rest lost on the way. */
function TopUp(props: { readonly topUp: Coming; readonly offline: boolean; readonly onKit: (kit: Kit) => void }) {
  const { topUp, offline } = props;
  const [scanned, setScanned] = useState<readonly string[]>([]);
  const [rest, setRest] = useState<"on_its_way" | "missing">("on_its_way");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, once] = useOneAtATime();
  const pieces = topUp.units.length > 0;
  const unscanned = topUp.quantity - scanned.length;
  const receive = () =>
    once(async () => {
      const answer = await api.receiveTopUp(topUp.id, pieces ? scanned : null, rest);
      if (answer.ok) props.onKit(answer.body);
      else
        setProblem({ words: answer.status === 409 ? copy.coming.settled : copy.notDone, requestId: answer.requestId });
    });
  const label = pieces ? copy.coming.receiveScanned(scanned.length) : copy.coming.receive;
  return (
    <li className={styles.item}>
      <p className={styles.name}>{copy.coming.line(topUp.name, amountOf(topUp.quantity, topUp.unit))}</p>
      <p className={styles.note}>{copy.coming.from(topUp.from, dayMonth(indiaDate(topUp.sent_at)))}</p>
      {pieces && (
        <>
          <div className={styles.progress}>
            <ProgressLine className={styles.track} value={scanned.length / topUp.units.length} />
            <span className={styles.count}>{copy.coming.scanned(scanned.length, topUp.units.length)}</span>
          </div>
          <ScanField
            className={styles.fieldLabel}
            words={{ ...copy.scan, ...steps.piece.camera }}
            onScan={(scan) => {
              if (!topUp.units.includes(scan)) {
                setProblem({ words: copy.coming.notOnIt, requestId: null });
                return;
              }
              setProblem(null);
              if (!scanned.includes(scan)) setScanned([...scanned, scan]);
            }}
          />
          {scanned.length > 0 && unscanned > 0 && <RestOf count={unscanned} rest={rest} onRest={setRest} />}
        </>
      )}
      <NotDone problem={problem} />
      <div className={styles.buttons}>
        <Button
          variant={pieces ? "primary" : "outline"}
          size="action"
          busy={busy}
          disabled={offline || (pieces && scanned.length === 0)}
          onClick={() => void receive()}
        >
          {offline ? copy.needsSignal : label}
        </Button>
      </div>
    </li>
  );
}

export function Arriving(props: { readonly kit: Kit; readonly offline: boolean; readonly onKit: (kit: Kit) => void }) {
  if (props.kit.coming.length === 0) return null;
  return (
    <section className={styles.section} aria-labelledby="kit-coming">
      <SectionHead id="kit-coming" title={copy.coming.title} />
      <ul className={styles.list}>
        {props.kit.coming.map((topUp) => (
          <TopUp key={topUp.id} topUp={topUp} offline={props.offline} onKit={props.onKit} />
        ))}
      </ul>
    </section>
  );
}
