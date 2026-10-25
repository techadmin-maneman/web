// A long list a page at a time: which rows of how many are shown, "1–50 of 312", and the way to the page before and
// the page after. usePages cuts the rows; Pager draws where they stand. The words are the app's.
//
//   const pages = usePages(rows, 50);
//   <Pager pages={pages} words={copy.pages} />
//   {pages.shown.map(...)}

import { GLYPHS } from "@maneman/brand/icons";
import { useState } from "react";
import { IconButton } from "./IconButton.tsx";
import styles from "./pager.module.css";

export interface Pages<T> {
  /** The rows of the page shown. */
  readonly shown: readonly T[];
  /** The first and last row shown, counted from one, and how many rows there are. */
  readonly from: number;
  readonly to: number;
  readonly total: number;
  readonly page: number;
  readonly last: number;
  readonly go: (page: number) => void;
}

/** The rows of one page; a list that changes length, as a search narrows it, goes back to its first. */
export function usePages<T>(rows: readonly T[], size: number): Pages<T> {
  const [at, setAt] = useState({ page: 0, total: rows.length });
  const page = at.total === rows.length ? at.page : 0;
  const last = Math.max(0, Math.ceil(rows.length / size) - 1);
  const start = Math.min(page, last) * size;
  return {
    shown: rows.slice(start, start + size),
    from: rows.length === 0 ? 0 : start + 1,
    to: Math.min(rows.length, start + size),
    total: rows.length,
    page: Math.min(page, last),
    last,
    go: (to) => {
      setAt({ page: Math.max(0, Math.min(last, to)), total: rows.length });
    },
  };
}

export interface PagerWords {
  readonly range: (from: number, to: number, total: number) => string;
  readonly previous: string;
  readonly next: string;
}

/** Where the page stands, and the pages either side; nothing at all for a list that fits on one. */
export function Pager<T>({ pages, words }: { readonly pages: Pages<T>; readonly words: PagerWords }) {
  if (pages.last === 0) return null;
  return (
    <span className={styles.pager}>
      <span>{words.range(pages.from, pages.to, pages.total)}</span>
      <IconButton
        className={styles.previous}
        d={GLYPHS.chevron}
        size="sm"
        label={words.previous}
        disabled={pages.page === 0}
        onClick={() => {
          pages.go(pages.page - 1);
        }}
      />
      <IconButton
        d={GLYPHS.chevron}
        size="sm"
        label={words.next}
        disabled={pages.page === pages.last}
        onClick={() => {
          pages.go(pages.page + 1);
        }}
      />
    </span>
  );
}
