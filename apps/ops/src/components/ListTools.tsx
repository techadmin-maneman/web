// A long list's own tools above it: a search through what each row says, how many match, and its pages. A list short
// enough to read whole has neither. The rows it hands to its children are the page's, as the search left them:
//   <ListTools rows={lots} textOf={(lot) => lot.name} label={copy.find}>{(shown) => <Table>…</Table>}</ListTools>

import { Note } from "@maneman/ui/Note";
import { Pager, usePages } from "@maneman/ui/Pager";
import { SearchInput } from "@maneman/ui/SearchInput";
import { Toolbar } from "@maneman/ui/Toolbar";
import { useState, type ReactNode } from "react";
import { LIST_TOOLS as copy } from "../content.ts";
import styles from "./list-tools.module.css";

/** A list longer than this takes a search; one longer than a page takes pages too. */
const SEARCH_FROM = 10;
const PAGE = 50;

export function ListTools<T>({
  rows,
  textOf,
  label,
  children,
}: {
  readonly rows: readonly T[];
  /** What a row says, which the search reads. */
  readonly textOf: (row: T) => string;
  /** What the search looks through: "Find a lot or a place". */
  readonly label: string;
  readonly children: (shown: readonly T[]) => ReactNode;
}) {
  const [find, setFind] = useState("");
  const wanted = find.trim().toLowerCase();
  const matching = wanted === "" ? rows : rows.filter((row) => textOf(row).toLowerCase().includes(wanted));
  const pages = usePages(matching, PAGE);
  if (rows.length <= SEARCH_FROM) return children(rows);
  return (
    <>
      <Toolbar
        label={label}
        className={styles.tools}
        end={
          <>
            {wanted !== "" && <span>{copy.matching(matching.length)}</span>}
            <Pager pages={pages} words={copy.pages} />
          </>
        }
      >
        <SearchInput label={label} value={find} onChange={setFind} className={styles.find} />
      </Toolbar>
      {matching.length === 0 ? <Note>{copy.none(find.trim())}</Note> : children(pages.shown)}
    </>
  );
}
