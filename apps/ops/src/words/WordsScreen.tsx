// Growth · Words (docs/decisions/0126-the-words-page.md): every line of the site and every WhatsApp message to a
// client, found by page or by what it says. A row opens the line's record beside the table, where its wording changes
// where it reads, with its history beneath it (docs/decisions/0212-editing-in-place.md).

import { Toast } from "@maneman/ui/Toast";
import { whoWords } from "../lib/who.ts";
import { Button } from "@maneman/ui/Button";
import { Panel } from "@maneman/ui/Panel";
import { Table, TableScroll } from "@maneman/ui/Table";
import { TextButton } from "@maneman/ui/TextLink";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaDate, shortDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { type Word } from "../api.ts";
import { Narrowing, SortHeads, TableEnd } from "../components/TableTools.tsx";
import { useTableView, type Column, type TableView } from "../components/useTableView.ts";
import { words as copy } from "../content/words.ts";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { placeOf, WordRecord } from "./WordForm.tsx";
import { LastPublished, PublishCheck } from "./WordsPublish.tsx";
import form from "../components/forms.module.css";
import styles from "./words-screen.module.css";
import { FormDrawer } from "../components/FormDrawer.tsx";
import { wordsApi } from "./words-api.ts";

function WordRow({ word, onOpen }: { word: Word; onOpen: (key: string) => void }) {
  const place = placeOf(word);
  return (
    <tr>
      <td className={styles.page}>{word.group}</td>
      <th scope="row" className={styles.where}>
        <TextButton
          compact
          aria-label={copy.open(place)}
          onClick={() => {
            onOpen(word.key);
          }}
        >
          {place}
        </TextButton>
      </th>
      <td className={styles.text}>
        {word.now}
        {word.changed !== null && (
          <span className={styles.changed}>
            {copy.changed(whoWords(word.changed.by), shortDate(indiaDate(word.changed.at)))}
          </span>
        )}
        {word.on_site === false && <span className={styles.changed}>{copy.notOnSite}</span>}
        {!word.reviewed && <span className={styles.changed}>{copy.review.notReviewed}</span>}
      </td>
    </tr>
  );
}

/** What Find words looks in: a line's place and wordings, and "Not reviewed" for a line no copy review has read. */
const searchedFor = (word: Word): string =>
  `${placeOf(word)} ${word.now} ${word.text}${word.reviewed ? "" : ` ${copy.review.notReviewed}`}`;

const TABLE_COLUMNS: readonly Column<Word>[] = [
  { label: copy.columns.page, choice: (word) => word.group, sort: (word) => word.group },
  { label: copy.columns.where, sort: (word) => placeOf(word) },
  { label: copy.columns.wording },
];

/** The table of lines, found by page or by what they say, a page at a time. */
function WordsTable({ view, onOpen }: { view: TableView<Word>; onOpen: (key: string) => void }) {
  return (
    <>
      <Narrowing view={view} label={copy.narrow} className={styles.narrow} />
      <TableScroll labelledBy="words">
        <Table className={styles.table}>
          <thead>
            <tr>
              <SortHeads view={view} />
            </tr>
          </thead>
          <tbody>
            {view.shown.map((word) => (
              <WordRow key={word.key} word={word} onOpen={onOpen} />
            ))}
          </tbody>
        </Table>
      </TableScroll>
      <TableEnd view={view} />
    </>
  );
}

function Words() {
  const [loaded, retry] = useLoad(wordsApi.words);
  /** Each line as its last change left it, so the table follows a change without reading the list again. */
  const [changed, setChanged] = useState<ReadonlyMap<string, Word>>(new Map());
  const [open, setOpen] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const access = useAccess();
  const rows = loaded.state === "loaded" ? loaded.value.words.map((word) => changed.get(word.key) ?? word) : [];
  const view = useTableView(rows, TABLE_COLUMNS, { search: searchedFor });
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const opened = rows.find((word) => word.key === open);
  const keep = (word: Word) => {
    setChanged(new Map([...changed, [word.key, word]]));
  };
  const mayPublish = access.mayCall("POST /api/words/publish");
  return (
    <Panel
      titleId="words"
      title={copy.title}
      padded
      actions={
        mayPublish &&
        !publishing && (
          <Button
            variant="outline"
            size="small"
            narrow
            onClick={() => {
              setSaid(null);
              setPublishing(true);
            }}
          >
            {copy.publish.open}
          </Button>
        )
      }
    >
      <LastPublished published={loaded.value.published} />
      {publishing && (
        <PublishCheck
          unpublished={rows.filter((word) => word.on_site === false).length}
          onDone={() => {
            setPublishing(false);
            setChanged(new Map());
            setSaid(copy.publish.done);
            retry();
          }}
          onBack={() => {
            setPublishing(false);
          }}
        />
      )}
      {said !== null && <Toast>{said}</Toast>}
      <WordsTable
        view={view}
        onOpen={(key) => {
          setSaid(null);
          setOpen(key);
        }}
      />
      {opened !== undefined && (
        <FormDrawer
          title={placeOf(opened)}
          onClose={() => {
            setOpen(null);
          }}
        >
          <WordRecord word={opened} messages={loaded.value.messages} onSaved={keep} />
        </FormDrawer>
      )}
    </Panel>
  );
}

export function WordsScreen() {
  return (
    <div className={form.screen}>
      <Words />
    </div>
  );
}
