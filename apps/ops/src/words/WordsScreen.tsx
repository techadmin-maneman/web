// Growth · Words (docs/decisions/0126-the-words-page.md): every line of the site and every WhatsApp message to a
// client, found by page or by what it says, each changed in its row, with its history beneath it.

import { whoWords } from "../lib/who.ts";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Button, RowButton } from "@maneman/ui/Button";
import { Panel } from "@maneman/ui/Panel";
import { Table, TableScroll } from "@maneman/ui/Table";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaDate, shortDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { type Word } from "../api.ts";
import { Narrowing, SortHeads, TableEnd } from "../components/TableTools.tsx";
import { useTableView, type Column, type TableView } from "../components/useTableView.ts";
import { words as copy } from "../content/words.ts";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { placeOf, WordForm, type Messages } from "./WordForm.tsx";
import { WordHistory } from "./WordHistory.tsx";
import { LastPublished, PublishCheck } from "./WordsPublish.tsx";
import form from "../components/forms.module.css";
import styles from "./words-screen.module.css";
import { FormDrawer } from "../components/FormDrawer.tsx";
import { wordsApi } from "./words-api.ts";

/** What is open beneath a line's row: its form, opened with a wording, or its history. */
type Acting =
  | { readonly key: string; readonly kind: "edit"; readonly start: string }
  | { readonly key: string; readonly kind: "history" }
  | null;

interface RowProps {
  readonly mayChange: boolean;
  /** Whether messages send in new words at once, or once WhatsApp approves them. */
  readonly messages: Messages;
  readonly acting: Acting;
  readonly onAct: (acting: Acting) => void;
  readonly onDone: (word: Word) => void;
}

function WordActions({ word, mayChange, acting, onAct }: { word: Word } & Omit<RowProps, "onDone">) {
  const place = placeOf(word);
  return (
    <td className={styles.actions}>
      {mayChange && (
        <RowButton
          beside
          aria-label={copy.editLabel(place)}
          disabled={acting !== null}
          onClick={() => {
            onAct({ key: word.key, kind: "edit", start: word.now });
          }}
        >
          {copy.edit}
        </RowButton>
      )}
      <RowButton
        beside
        aria-label={copy.historyLabel(place)}
        disabled={acting !== null}
        onClick={() => {
          onAct({ key: word.key, kind: "history" });
        }}
      >
        {copy.history}
      </RowButton>
    </td>
  );
}

function WordActingRow({ word, ...row }: { word: Word } & RowProps) {
  const { acting, onAct } = row;
  if (acting?.key !== word.key) return null;
  const close = () => {
    onAct(null);
  };
  return (
    <FormDrawer title={placeOf(word)} onClose={close}>
      {acting.kind === "edit" ? (
        <WordForm word={word} start={acting.start} messages={row.messages} onDone={row.onDone} onCancel={close} />
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
    </FormDrawer>
  );
}

function WordRows({ word, ...row }: { word: Word } & RowProps) {
  return (
    <>
      <tr>
        <td className={styles.page}>{word.group}</td>
        <th scope="row" className={styles.where}>
          {placeOf(word)}
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
        <WordActions word={word} {...row} />
      </tr>
      <WordActingRow word={word} {...row} />
    </>
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
function WordsTable({ view, row }: { view: TableView<Word>; row: RowProps }) {
  return (
    <>
      <Narrowing view={view} label={copy.narrow} className={styles.narrow} />
      <TableScroll labelledBy="words">
        <Table controls className={styles.table}>
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
      </TableScroll>
      <TableEnd view={view} />
    </>
  );
}

function Words() {
  const [loaded, retry] = useLoad(wordsApi.words);
  /** Each line as its last change left it, so the table follows a change without reading the list again. */
  const [changed, setChanged] = useState<ReadonlyMap<string, Word>>(new Map());
  const [acting, setActing] = useState<Acting>(null);
  const [publishing, setPublishing] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const access = useAccess();
  const rows = loaded.state === "loaded" ? loaded.value.words.map((word) => changed.get(word.key) ?? word) : [];
  const view = useTableView(rows, TABLE_COLUMNS, { search: searchedFor });
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const row: RowProps = {
    mayChange: access.mayCall("POST /api/words"),
    messages: loaded.value.messages,
    acting,
    onAct: (next) => {
      setSaid(null);
      setActing(next);
    },
    onDone: (word) => {
      setChanged(new Map([...changed, [word.key, word]]));
      setActing(null);
      setSaid(copy.done);
    },
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
      {said !== null && (
        <InlineMessage tone="saved" className={form.saved}>
          {said}
        </InlineMessage>
      )}
      <WordsTable view={view} row={row} />
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
