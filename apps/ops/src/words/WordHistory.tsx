// Every wording a line has had, newest first (docs/decisions/0126-the-words-page.md), and the code's own: each can be
// used again, which opens the line's form with it to review.

import { whoWords } from "../lib/who.ts";
import { Button, RowButton } from "@maneman/ui/Button";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaDate, shortDate } from "@maneman/web-kit/dates";
import { useCallback } from "react";
import { api, type Word } from "../api.ts";
import { words as copy } from "../content/words.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { placeOf } from "./WordForm.tsx";
import styles from "../components/forms.module.css";
import own from "./words.module.css";

const versions = copy.versions;

function UseButton({ label, onUse }: { label: string; onUse: () => void }) {
  return (
    <RowButton className={styles.inline} aria-label={label} onClick={onUse}>
      {versions.use}
    </RowButton>
  );
}

export function WordHistory(props: {
  readonly word: Word;
  readonly mayChange: boolean;
  readonly onUse: (text: string) => void;
  readonly onClose: () => void;
}) {
  const { word } = props;
  const load = useCallback(() => api.wordHistory(word.key), [word.key]);
  const [loaded, retry] = useLoad(load);
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const kept = loaded.value.versions;
  return (
    <section className={styles.group} aria-label={versions.title(placeOf(word))}>
      <h3 className={styles.ruleTitle}>{versions.title(placeOf(word))}</h3>
      {kept.length === 0 && <p className={styles.note}>{versions.none}</p>}
      <ol className={own.versions}>
        {kept.map((version) => {
          const day = shortDate(indiaDate(version.set_at));
          const text = version.text ?? word.text;
          return (
            <li key={version.id} className={own.version}>
              <span className={own.when}>{versions.by(whoWords(version.set_by), day)}</span>
              <span className={own.said}>{version.text ?? versions.inCode}</span>
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
          <li className={own.version}>
            <span className={own.when}>{versions.inCode}</span>
            <span className={own.said}>{word.text}</span>
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
      <div className={styles.actions}>
        <Button variant="outline" size="small" className={styles.quiet} onClick={props.onClose}>
          {versions.close}
        </Button>
      </div>
    </section>
  );
}
