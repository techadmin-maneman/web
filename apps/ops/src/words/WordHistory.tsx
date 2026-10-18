// Every wording a line has had, newest first (docs/decisions/0126-the-words-page.md), and the code's own: each can be
// used again, which opens the line's box with it, to read before it is kept.

import { whoWords } from "../lib/who.ts";
import { RowButton } from "@maneman/ui/Button";
import { Note } from "@maneman/ui/Note";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaDate, shortDate } from "@maneman/web-kit/dates";
import { useCallback } from "react";
import { type Word } from "../api.ts";
import { words as copy } from "../content/words.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { placeOf } from "./WordForm.tsx";
import form from "../components/forms.module.css";
import styles from "./word-history.module.css";
import { wordsApi } from "./words-api.ts";

const versions = copy.versions;

function UseButton({ label, onUse }: { label: string; onUse: () => void }) {
  return (
    <RowButton beside aria-label={label} onClick={onUse}>
      {versions.use}
    </RowButton>
  );
}

export function WordHistory(props: {
  readonly word: Word;
  readonly mayChange: boolean;
  readonly onUse: (text: string) => void;
}) {
  const { word } = props;
  const load = useCallback(() => wordsApi.wordHistory(word.key), [word.key]);
  const [loaded, retry] = useLoad(load);
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const kept = loaded.value.versions;
  return (
    <section className={form.group} aria-label={versions.title(placeOf(word))}>
      <h3 className={form.ruleTitle}>{versions.title(placeOf(word))}</h3>
      {kept.length === 0 && <Note>{versions.none}</Note>}
      <ol className={styles.versions}>
        {kept.map((version) => {
          const day = shortDate(indiaDate(version.set_at));
          const text = version.text ?? word.text;
          return (
            <li key={version.id} className={styles.version}>
              <span className={styles.when}>{versions.by(whoWords(version.set_by), day)}</span>
              <span className={styles.said}>{version.text ?? versions.inCode}</span>
              {props.mayChange && text !== word.now && (
                <UseButton
                  label={versions.useLabel(day)}
                  onUse={() => {
                    props.onUse(text);
                  }}
                />
              )}
            </li>
          );
        })}
        {word.changed !== null && kept.every((version) => version.text !== null) && (
          <li className={styles.version}>
            <span className={styles.when}>{versions.inCode}</span>
            <span className={styles.said}>{word.text}</span>
            {props.mayChange && (
              <UseButton
                label={copy.form.toCode}
                onUse={() => {
                  props.onUse(word.text);
                }}
              />
            )}
          </li>
        )}
      </ol>
    </section>
  );
}
