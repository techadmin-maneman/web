// Above the grid: the week, the city, and a way to find one row among many.
// The brief asks for "a city and week picker" (A1); the board letters the city
// in its header and draws no control, so they stand in a row of their own
// (docs/fidelity-method.md). Finding narrows the rows only: the figures at each
// column's head stay the day's own.

import type { Board, BoardQuery } from "../api.ts";
import { dispatch } from "../content.ts";
import styles from "./dispatch.module.css";
import { addDays } from "./job.ts";

interface Props {
  /** The board on screen; null while the first one loads. */
  readonly board: Board | null;
  readonly query: BoardQuery;
  readonly onQuery: (query: BoardQuery) => void;
  readonly find: string;
  readonly onFind: (text: string) => void;
}

export function Toolbar({ board, query, onQuery, find, onFind }: Props) {
  const copy = dispatch.tools;
  const shift = (days: number) => {
    if (board !== null) onQuery({ ...query, from: addDays(board.from, days) });
  };

  return (
    <div className={styles.tools} role="group" aria-label={copy.label}>
      <div className={styles.weeks}>
        <button
          className={styles.tool}
          type="button"
          disabled={board === null}
          onClick={() => {
            shift(-7);
          }}
        >
          {copy.previous}
        </button>
        <button
          className={styles.tool}
          type="button"
          disabled={query.from === null}
          onClick={() => {
            onQuery({ ...query, from: null });
          }}
        >
          {copy.thisWeek}
        </button>
        <button
          className={styles.tool}
          type="button"
          disabled={board === null}
          onClick={() => {
            shift(7);
          }}
        >
          {copy.next}
        </button>
      </div>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="dispatch-city">
          {copy.city}
        </label>
        <select
          id="dispatch-city"
          className={styles.select}
          value={query.city ?? ""}
          onChange={(event) => {
            onQuery({ ...query, city: event.currentTarget.value === "" ? null : event.currentTarget.value });
          }}
        >
          <option value="">{copy.everyCity}</option>
          {(board?.cities ?? []).map((city) => (
            <option key={city} value={city}>
              {city}
            </option>
          ))}
        </select>
      </div>
      <div className={`${styles.field ?? ""} ${styles.find ?? ""}`}>
        <label className={styles.fieldLabel} htmlFor="dispatch-find">
          {copy.find}
        </label>
        <input
          id="dispatch-find"
          className={styles.input}
          type="search"
          value={find}
          onChange={(event) => {
            onFind(event.currentTarget.value);
          }}
        />
      </div>
    </div>
  );
}
