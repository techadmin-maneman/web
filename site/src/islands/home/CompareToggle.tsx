// A phone's comparison or range (ADR 0263): the options as toggles above their rows. Against ("versus") shows the
// option chosen beside the last column, the hair system, a row at a time; otherwise each row is the chosen option's
// value. Every option's rows are the page's own, so without scripts the first shows.

import "../refs-as-props.ts";
import { Segmented } from "@maneman/ui/Segmented";
import { useState } from "preact/hooks";
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
  const [at, setAt] = useState("0");
  const chosen = Number(at);

  return (
    <div class={styles.toggle}>
      <Segmented
        pressed
        label={props.label}
        options={choices.map((choice, index) => [String(index), choice] as const)}
        value={at}
        onChange={setAt}
      />
      {props.versus ? (
        <div class={styles.versus}>
          <div class={styles.head}>
            <span>{choices[chosen]}</span>
            <span>{props.columns[ours]}</span>
          </div>
          {props.rows.map((row) => (
            <div class={styles.pair} key={row.label}>
              <p class={styles.key}>{row.label}</p>
              <div class={styles.cells}>
                <span class={styles.them}>
                  <Cell cell={row.cells[chosen]} yes={props.yes} no={props.no} />
                </span>
                <span class={styles.us}>
                  <Cell cell={row.cells[ours]} yes={props.yes} no={props.no} />
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
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
      )}
    </div>
  );
}
