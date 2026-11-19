// The rows chosen in a list, to act on together, as every list chooses them: a box ticks one, a box ticked with Shift
// held ticks or clears the run from the last one ticked, and the head's box takes every row shown, or none. A row no
// longer shown, closed or narrowed away, is let go.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface RowSelection {
  /** The rows chosen, of those shown. */
  readonly selected: ReadonlySet<string>;
  /** Every row shown is chosen. */
  readonly all: boolean;
  /** One row ticked or cleared; `run`, with Shift held, every row from the last one ticked to it. */
  readonly toggle: (key: string, run: boolean) => void;
  readonly toggleAll: () => void;
  readonly clear: () => void;
  /** Only these rows chosen, as after acting on a choice, the rest let go. */
  readonly only: (keys: readonly string[]) => void;
}

/** The rows from `from` to `to` in the order shown, both ends included; only `to` where `from` is not shown. */
function runOf(keys: readonly string[], from: string | null, to: string): readonly string[] {
  const start = from === null ? -1 : keys.indexOf(from);
  const end = keys.indexOf(to);
  if (start === -1 || end === -1) return [to];
  return keys.slice(Math.min(start, end), Math.max(start, end) + 1);
}

/** `keys`: each row shown, in the order shown. */
export function useRowSelection(keys: readonly string[]): RowSelection {
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const last = useRef<string | null>(null);
  const selected = useMemo(() => new Set(keys.filter((key) => chosen.has(key))), [keys, chosen]);
  // A row narrowed away or closed is let go, so it is not chosen when it is shown again.
  useEffect(() => {
    setChosen((was) => (selected.size === was.size ? was : new Set(selected)));
  }, [selected]);
  const toggle = useCallback(
    (key: string, run: boolean) => {
      const rows = run ? runOf(keys, last.current, key) : [key];
      last.current = key;
      setChosen((was) => {
        const next = new Set(was);
        const on = !was.has(key);
        for (const row of rows) {
          if (on) next.add(row);
          else next.delete(row);
        }
        return next;
      });
    },
    [keys],
  );
  const all = keys.length > 0 && selected.size === keys.length;
  const toggleAll = useCallback(() => {
    setChosen(all ? new Set() : new Set(keys));
  }, [all, keys]);
  const clear = useCallback(() => {
    last.current = null;
    setChosen(new Set());
  }, []);
  const only = useCallback((keep: readonly string[]) => {
    last.current = null;
    setChosen(new Set(keep));
  }, []);
  return { selected, all, toggle, toggleAll, clear, only };
}
