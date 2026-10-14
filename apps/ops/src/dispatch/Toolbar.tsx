// Above the grid: the week, the city, and a search for one row among many, in a row of their own since the design draws
// no control for them (docs/fidelity-method.md). The search narrows the rows only: each day's figures stay the day's
// own.

import { Label, Select, TextInput } from "@maneman/ui/Field";
import { Button } from "@maneman/ui/Button";
import { classes } from "@maneman/ui/classes";
import type { Board, BoardQuery } from "../api.ts";
import { dispatch } from "../content.ts";
import styles from "./dispatch.module.css";
import { addDays } from "@maneman/web-kit/dates";

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
        <Button
          variant="outline"
          size="compact"
          disabled={board === null}
          onClick={() => {
            shift(-7);
          }}
        >
          {copy.previous}
        </Button>
        <Button
          variant="outline"
          size="compact"
          disabled={query.from === null}
          onClick={() => {
            onQuery({ ...query, from: null });
          }}
        >
          {copy.thisWeek}
        </Button>
        <Button
          variant="outline"
          size="compact"
          disabled={board === null}
          onClick={() => {
            shift(7);
          }}
        >
          {copy.next}
        </Button>
      </div>
      <div className={styles.field}>
        <Label htmlFor="dispatch-city">{copy.city}</Label>
        <Select
          id="dispatch-city"
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
        </Select>
      </div>
      <div className={classes(styles.field, styles.find)}>
        <Label htmlFor="dispatch-find">{copy.find}</Label>
        <TextInput
          id="dispatch-find"
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
