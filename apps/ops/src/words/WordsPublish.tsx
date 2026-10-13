// Publishing the site's words from the Words page (docs/decisions/0127-publishing-the-words.md): when the site was
// last published, and the check before the next publish, which says how many lines changed since and when the site
// shows them. Only its second press publishes.

import { InlineMessage } from "@maneman/ui/InlineMessage";
import { indiaDate, shortDate } from "@maneman/web-kit/dates";
import { errorText, type Failure } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { api, type WordsPublish } from "../api.ts";
import { CheckPanel } from "../components/CheckPanel.tsx";
import { words as copy } from "../content/words.ts";
import styles from "../components/forms.module.css";

const { publish } = copy;

/** When the site's words were last published, and by whom. */
export function LastPublished({ published }: { published: WordsPublish | null }) {
  return (
    <p className={styles.note}>
      {published === null ? publish.never : publish.last(shortDate(indiaDate(published.at)), published.by)}
    </p>
  );
}

/** The check before a publish: the lines changed since the last, and when this environment's site shows them. */
export function PublishCheck(props: {
  readonly unpublished: number;
  readonly onDone: (published: WordsPublish) => void;
  readonly onBack: () => void;
}) {
  const [step, setStep] = useState<"checking" | "sending" | Failure>("checking");
  const send = async () => {
    setStep("sending");
    const answer = await api.publishWords();
    if (!answer.ok) {
      setStep({ code: answer.code, fields: answer.fields });
      return;
    }
    props.onDone(answer.body.published);
  };
  const when = import.meta.env.MM_ENV === "production" ? publish.production : publish.staging;
  return (
    <>
      <CheckPanel
        question={publish.title}
        lines={props.unpublished === 0 ? [publish.none] : [publish.changed(props.unpublished), when]}
        busy={step === "sending"}
        ready={props.unpublished > 0}
        onSend={() => void send()}
        onBack={props.onBack}
      />
      {typeof step === "object" && (
        <InlineMessage tone="error" className={styles.error}>
          {errorText(copy.errors, step)}
        </InlineMessage>
      )}
    </>
  );
}
