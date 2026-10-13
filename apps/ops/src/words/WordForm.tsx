// A line given new words (docs/decisions/0126-the-words-page.md): the code's wording above the box, the holes the page
// fills to keep and the length the layout holds beneath it, then what the line is now beside what it will be, and only
// the second press saves it (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).

import { Field, TextArea } from "@maneman/ui/Field";
import { useState } from "react";
import { api, type Word } from "../api.ts";
import { words as copy } from "../content/words.ts";
import { SettingForm, sentOf, useSteps } from "../settings/index.ts";
import styles from "../components/forms.module.css";
import own from "./words.module.css";

const { form, check } = copy;


/** What the page or the sender fills: "{city}", "{{2}}". */
const holesOf = (text: string): string[] => [...new Set(text.match(/\{\{\d+\}\}|\{[a-zA-Z]+\}/g) ?? [])];

/** Whether messages send in new words at once, as the bridge does, or once WhatsApp approves them, as MSG91 does. */
export type Messages = "at_once" | "after_approval";

/** Where a line sits, as the table names it: "hero.title", "visit_reminder_v1". */
export const placeOf = (word: Word): string => word.key.replace(/^site:[^/]+\//, "").replace(/^message:/, "");

export function WordForm(props: {
  readonly word: Word;
  /** The wording the box opens with: the one in force, or an earlier one to go back to. */
  readonly start: string;
  readonly messages: Messages;
  readonly onDone: (word: Word) => void;
  readonly onCancel: () => void;
}) {
  const { word } = props;
  const [text, setText] = useState(props.start);
  const steps = useSteps(
    async () => sentOf(await api.setWord(word.key, text === word.text ? null : text), (body) => ({ word: body.word })),
    (sent) => {
      props.onDone(sent.word);
    },
  );
  const holes = holesOf(word.text);
  return (
    <SettingForm
      title={form.title(placeOf(word))}
      steps={steps}
      ready={text.trim() !== "" && text !== word.now}
      errors={copy.errors}
      onCancel={props.onCancel}
      above={<p className={own.code}>{form.inCode(word.text)}</p>}
      checking={
        <>
          <p className={styles.checkLine}>{check.was(word.now)}</p>
          <p className={styles.checkLine}>{check.now(text)}</p>
        </>
      }
    >
      <div className={styles.fields}>
        <Field label={form.wording} className={own.wording}>
          {(control) => (
            <TextArea
              {...control}
              className={own.box}
              rows={word.surface === "message" ? 5 : 3}
              maxLength={word.longest}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                steps.edit();
              }}
            />
          )}
        </Field>
      </div>
      <p className={own.hint}>
        {holes.length > 0 && `${form.keep(holes.join(", "))} `}
        {form.longest(word.longest)}
      </p>
      {word.surface === "message" && (
        <p className={own.hint}>{props.messages === "at_once" ? form.atOnce : form.afterApproval}</p>
      )}
    </SettingForm>
  );
}
