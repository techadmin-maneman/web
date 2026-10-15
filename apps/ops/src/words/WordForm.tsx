// A line given new words (docs/decisions/0126-the-words-page.md): the code's wording above the box, the holes the page
// fills to keep and the length the layout holds beneath it, then what the line is now beside what it will be, and only
// the second press saves it (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).

import { CheckLine } from "../components/CheckPanel.tsx";
import { Field, TextArea } from "@maneman/ui/Field";
import { useState } from "react";
import { type Word } from "../api.ts";
import { words as copy } from "../content/words.ts";
import { SettingForm, sentOf, useSteps } from "../settings/index.ts";
import form from "../components/forms.module.css";
import styles from "./words.module.css";
import { wordsApi } from "./words-api.ts";

const { form: formWords, check } = copy;

/** What the page or the sender fills: "{city}", "{{2}}". */
const holesOf = (text: string): string[] => [...new Set(text.match(/\{\{\d+\}\}|\{[a-zA-Z]+\}/g) ?? [])];

/** Whether messages send in new words at once, as the bridge does, or once WhatsApp approves them, as MSG91 does. */
export type Messages = "at_once" | "after_approval";

/** A part of a line's place in words: "howItWorks" is "How it works", "visit_reminder_v1" is "Visit reminder". */
function partOf(name: string): string {
  const said =
    copy.places[name] ??
    name
      .replace(/_v\d+$/, "")
      .replaceAll("_", " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2");
  return said.charAt(0).toUpperCase() + said.slice(1).toLowerCase();
}

/** Where a line sits, as the table names it: "Header · Menu link 1 · Label"; a message by its name. */
export function placeOf(word: Word): string {
  const path = word.key.replace(/^site:[^/]+\//, "").replace(/^message:/, "");
  const parts: string[] = [];
  for (const name of path.split(".")) {
    const last = parts.length - 1;
    if (/^\d+$/.test(name) && last >= 0) parts[last] = `${parts[last] ?? ""} ${String(Number(name) + 1)}`;
    else parts.push(partOf(name));
  }
  return parts.join(" · ");
}

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
    async () =>
      sentOf(await wordsApi.setWord(word.key, text === word.text ? null : text), (body) => ({ word: body.word })),
    (sent) => {
      props.onDone(sent.word);
    },
  );
  const holes = holesOf(word.text);
  return (
    <SettingForm
      title={formWords.title(placeOf(word))}
      steps={steps}
      ready={text.trim() !== "" && text !== word.now}
      errors={copy.errors}
      onCancel={props.onCancel}
      above={<p className={styles.code}>{formWords.inCode(word.text)}</p>}
      checking={
        <>
          <CheckLine>{check.was(word.now)}</CheckLine>
          <CheckLine>{check.now(text)}</CheckLine>
        </>
      }
    >
      <div className={form.fields}>
        <Field label={formWords.wording} className={styles.wording}>
          {(control) => (
            <TextArea
              {...control}
              className={styles.box}
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
      <p className={styles.hint}>
        {holes.length > 0 && `${formWords.keep(holes.join(", "))} `}
        {formWords.longest(word.longest)}
      </p>
      {word.surface === "message" && (
        <p className={styles.hint}>{props.messages === "at_once" ? formWords.atOnce : formWords.afterApproval}</p>
      )}
    </SettingForm>
  );
}
