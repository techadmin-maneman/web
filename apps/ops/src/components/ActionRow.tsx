// A row that opens beneath another for acting on it, as wide as its table: the count is read from the table's own
// header, so a column added to the table is never left out of it.

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

export function ActionRow({ className, children }: { className?: string | undefined; children: ReactNode }) {
  const row = useRef<HTMLTableRowElement>(null);
  const [span, setSpan] = useState(1);
  useLayoutEffect(() => {
    const head = row.current?.closest("table")?.tHead?.rows[0];
    if (head !== undefined) setSpan([...head.cells].reduce((count, cell) => count + cell.colSpan, 0));
  }, []);
  return (
    <tr ref={row} className={className}>
      <td colSpan={span}>{children}</td>
    </tr>
  );
}
