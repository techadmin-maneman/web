// Growth · Words (docs/decisions/0126-the-words-page.md): every line of the site and every WhatsApp message to a
// client, found by page or by what it says, each changed in its row, with its history beneath it.

import { Panel } from "@maneman/ui/Panel";
import { Table } from "@maneman/ui/Table";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { classes } from "@maneman/ui/classes";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaDate, shortDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { api, type Word } from "../api.ts";
import { Shell } from "../components/Shell.tsx";
import { Narrowing, SortHeads, TableEnd } from "../components/TableTools.tsx";
import { useTableView, type Column } from "../components/useTableView.ts";
import { words as copy } from "../content/words.ts";
import { useAccess } from "../lib/access.ts";
import { SECTION_NAMES } from "../route.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { placeOf, WordForm } from "./WordForm.tsx";
import { WordHistory } from "./WordHistory.tsx";
import styles from "../components/forms.module.css";
import own from "./words.module.css";

const COLUMNS = 4;

/** What is open beneath a line's row: its form, opened with a wording, or its history. */
type Acting =
  | { readonly key: string; readonly kind: "edit"; readonly start: string }
  | { readonly key: string; readonly kind: "history" }
  | null;

interface RowProps {
  readonly mayChange: boolean;
  readonly acting: Acting;
  readonly onAct: (acting: Acting) => void;
  readonly onDone: (word: Word) => void;
}

function RowActions({ word, mayChange, acting, onAct }: { word: Word } & Omit<RowProps, "onDone">) {
  const place = placeOf(word);
  return (
    <td className={own.actions}>
      {mayChange && (
        <button
          className={styles.inline}
          type="button"
          aria-label={copy.editLabel(place)}
          disabled={acting !== null}
          onClick={() => {
            onAct({ key: word.key, kind: "edit", start: word.now });
          }}
        >
          {copy.edit}
        </button>
      )}
      <button
        className={styles.inline}
        type="button"
        aria-label={copy.historyLabel(place)}
        disabled={acting !== null}
        onClick={() => {
          onAct({ key: word.key, kind: "history" });
        }}
      >
        {copy.history}
      </button>
    </td>
  );
}

function ActingRow({ word, ...row }: { word: Word } & RowProps) {
  const { acting, onAct } = row;
  if (acting?.key !== word.key) return null;
  const close = () => {
    onAct(null);
  };
  return (
    <tr className={own.acting}>
      <td colSpan={COLUMNS}>
        {acting.kind === "edit" ? (
          <WordForm word={word} start={acting.start} onDone={row.onDone} onCancel={close} />
        ) : (
          <WordHistory
            word={word}
            mayChange={row.mayChange}
            onUse={(text) => {
              onAct({ key: word.key, kind: "edit", start: text });
            }}
            onClose={close}
          />
        )}
      </td>
    </tr>
  );
}

function WordRows({ word, ...row }: { word: Word } & RowProps) {
  return (
    <>
      <tr>
        <td className={own.page}>{word.group}</td>
        <th scope="row" className={own.where}>
          {placeOf(word)}
        </th>
        <td className={own.text}>
          {word.now}
          {word.changed !== null && (
            <span className={own.changed}>{copy.changed(word.changed.by, shortDate(indiaDate(word.changed.at)))}</span>
          )}
        </td>
        <RowActions word={word} {...row} />
      </tr>
      <ActingRow word={word} {...row} />
    </>
  );
}

const TABLE_COLUMNS: readonly Column<Word>[] = [
  { label: copy.columns.page, choice: (word) => word.group, sort: (word) => word.group },
  { label: copy.columns.where, sort: (word) => placeOf(word) },
  { label: copy.columns.wording },
];

function Words() {
  const [loaded, retry] = useLoad(api.words);
  /** Each line as its last change left it, so the table follows a change without reading the list again. */
  const [changed, setChanged] = useState<ReadonlyMap<string, Word>>(new Map());
  const [acting, setActing] = useState<Acting>(null);
  const [said, setSaid] = useState(false);
  const mayChange = useAccess().mayCall("POST /api/words");
  const rows = loaded.state === "loaded" ? loaded.value.words.map((word) => changed.get(word.key) ?? word) : [];
  const view = useTableView(rows, TABLE_COLUMNS, { search: (word) => `${placeOf(word)} ${word.now} ${word.text}` });
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const row: RowProps = {
    mayChange,
    acting,
    onAct: (next) => {
      setSaid(false);
      setActing(next);
    },
    onDone: (word) => {
      setChanged(new Map([...changed, [word.key, word]]));
      setActing(null);
      setSaid(true);
    },
  };
  return (
    <Panel titleId="words" title={copy.title} className={styles.panel}>
      <Narrowing view={view} label={copy.narrow} className={own.narrow} />
      {said && (
        <p className={styles.saved} role="status">
          {copy.done}
        </p>
      )}
      <div className={own.scroll}>
        <Table className={classes(styles.table, own.table)}>
          <thead>
            <tr>
              <SortHeads view={view} />
              <th scope="col">
                <VisuallyHidden>{copy.columns.actions}</VisuallyHidden>
              </th>
            </tr>
          </thead>
          <tbody>
            {view.shown.map((word) => (
              <WordRows key={word.key} word={word} {...row} />
            ))}
          </tbody>
        </Table>
      </div>
      <TableEnd view={view} />
    </Panel>
  );
}

export function WordsScreen() {
  return (
    <Shell section="/words" title={SECTION_NAMES.words}>
      <div className={styles.screen}>
        <Words />
      </div>
    </Shell>
  );
}
