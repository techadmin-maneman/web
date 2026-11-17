// A phone's comparison or range (ADR 0263): the options as toggles above their rows. Against ("versus") shows the
// option chosen beside the last column, the hair system, a row at a time; otherwise each row is the chosen option's
// value. The page draws the toggles and every option's rows; where scripts run, the options not chosen are hidden from
// the first paint, so the page does not shrink when this runs; where they never run, every option's rows show one
// after another, each under its name, and the toggles are not drawn.

import "../refs-as-props.ts";
import { Segmented } from "@maneman/ui/Segmented";
import { hiddenLook } from "@maneman/ui/VisuallyHidden";
import { useEffect, useState } from "preact/hooks";
import type { ComparisonCell } from "../../content/site.ts";
import styles from "./CompareToggle.module.css";

interface Row {
  readonly label: string;
  readonly cells: readonly ComparisonCell[];
}

/** A cell's words: a yes or a no said in words, as the boards write them. */
function Cell({ cell, yes, no }: { cell: ComparisonCell | undefined; yes: string; no: string }) {
  if (typeof cell !== "boolean") return <>{cell ?? ""}</>;
  return <>{cell ? yes : no}</>;
}

export default function CompareToggle(props: {
  label: string;
  columns: readonly string[];
  rows: readonly Row[];
  yes: string;
  no: string;
  versus: boolean;
}) {
  const choices = props.versus ? props.columns.slice(0, -1) : props.columns;
  const ours = props.columns.length - 1;
  const oursName = props.columns[ours] ?? "";
  const [at, setAt] = useState("0");
  const [running, setRunning] = useState(false);
  useEffect(() => {
    setRunning(true);
  }, []);

  return (
    <div class={styles.toggle}>
      <div class={styles.choices}>
        <Segmented
          pressed
          label={props.label}
          options={choices.map((choice, index) => [String(index), choice] as const)}
          value={at}
          onChange={setAt}
        />
      </div>
      {choices.map((name, chosen) => {
        const isChosen = String(chosen) === at;
        const shown = { "data-chosen": String(isChosen), hidden: running && !isChosen };
        return props.versus ? (
          <div class={styles.versus} key={name} {...shown}>
            <div class={styles.head}>
              <span>{name}</span>
              <span>{oursName}</span>
            </div>
            {props.rows.map((row) => (
              <div class={styles.pair} key={row.label}>
                <p class={styles.key}>{row.label}</p>
                <div class={styles.cells}>
                  <span class={styles.them}>
                    <span class={hiddenLook}>{name}: </span>
                    <Cell cell={row.cells[chosen]} yes={props.yes} no={props.no} />
                  </span>
                  <span class={styles.us}>
                    <span class={hiddenLook}>{oursName}: </span>
                    <Cell cell={row.cells[ours]} yes={props.yes} no={props.no} />
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div key={name} {...shown}>
            <p class={styles.option}>{name}</p>
            <dl class={styles.list}>
              {props.rows.map((row) => (
                <div class={styles.row} key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>
                    <Cell cell={row.cells[chosen]} yes={props.yes} no={props.no} />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}
    </div>
  );
}
