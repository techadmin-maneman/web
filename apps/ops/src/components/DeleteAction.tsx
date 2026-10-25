// A Delete button for something added by mistake: pressed, it asks once, and only the second press deletes, a refusal
// said in the caller's words. In the danger tone it asks before what can be put back, as retiring a package; in the
// primary tone, before a page's main switch. Anything but the primary tone looks dangerous before it is pressed, and a
// switch that reaches everyone can ask for a word typed first.

import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { Button } from "@maneman/ui/Button";
import { Field, TextInput } from "@maneman/ui/Field";
import { useState } from "react";
import { deleting } from "../content.ts";
import styles from "./delete-action.module.css";
import { Refusal } from "./Refusal.tsx";

/** What the button, its question and its confirmation say. */
interface DeleteWords {
  readonly open: string;
  readonly label: (name: string) => string;
  readonly warning: (name: string) => string;
  readonly confirm: string;
  readonly sending: string;
  readonly cancel: string;
}

type Tone = "destructive" | "danger" | "primary";

type Answer<Body> = { readonly ok: true; readonly body: Body } | { readonly ok: false; readonly code: string };

/** The question, and the second press that answers it, held back until the word asked for is typed. */
function Asking(props: {
  name: string;
  tone: Tone;
  words: DeleteWords;
  typed: string | undefined;
  sending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [word, setWord] = useState("");
  const waiting = props.typed !== undefined && word.trim().toLowerCase() !== props.typed.toLowerCase();
  return (
    <div className={styles.asking}>
      <p className={styles.warning}>{props.words.warning(props.name)}</p>
      {props.typed !== undefined && (
        <Field label={deleting.typeToConfirm(props.typed)} className={styles.typed}>
          {(control) => (
            <TextInput
              {...control}
              compact
              width="figure"
              autoComplete="off"
              value={word}
              onChange={(event) => {
                setWord(event.target.value);
              }}
            />
          )}
        </Field>
      )}
      <div className={styles.actions}>
        <Button
          variant={props.tone}
          size="small"
          className={styles.quiet}
          disabled={props.sending || waiting}
          onClick={props.onConfirm}
        >
          {props.sending ? props.words.sending : props.words.confirm}
        </Button>
        <Button
          variant="outline"
          size="small"
          className={styles.quiet}
          disabled={props.sending}
          onClick={props.onCancel}
        >
          {props.words.cancel}
        </Button>
      </div>
    </div>
  );
}

export function DeleteAction<Body>({
  name,
  tone = "destructive",
  words: copy = deleting,
  typed,
  send,
  refusal,
  onDeleted,
  onCancel,
}: {
  /** What is deleted, as the page names it. */
  readonly name: string;
  /** Destructive for what cannot be undone; danger for what can be put back; primary for a page's main switch. */
  readonly tone?: Tone;
  /** Its own words, where what goes is not gone for good, as a member of staff taken off the list. */
  readonly words?: DeleteWords;
  /** A word to type before the second press goes, for a switch that reaches everyone. */
  readonly typed?: string;
  readonly send: () => Promise<Answer<Body>>;
  /** Why the API refused, in the page's own words. */
  readonly refusal: (code: string) => string;
  readonly onDeleted: (body: Body) => void | Promise<void>;
  /** Where a row's own Delete opened it: it opens asking, and Cancel closes it. */
  readonly onCancel?: () => void;
}) {
  const [asking, setAsking] = useState(onCancel !== undefined);
  const [sending, once] = useOneAtATime();
  const [failed, setFailed] = useState<string | null>(null);

  const remove = () =>
    once(async () => {
      setFailed(null);
      const answer = await send();
      if (!answer.ok) {
        // A row's own Delete keeps its panel, with the reason and its Cancel; the page's goes back to its button.
        if (onCancel === undefined) setAsking(false);
        setFailed(refusal(answer.code));
        return;
      }
      await onDeleted(answer.body);
    });

  return (
    <>
      {asking ? (
        <Asking
          name={name}
          tone={tone}
          words={copy}
          typed={typed}
          sending={sending}
          onConfirm={() => void remove()}
          onCancel={() => {
            setAsking(false);
            onCancel?.();
          }}
        />
      ) : (
        <div className={styles.actions}>
          <Button
            variant={tone === "primary" ? "outline" : "danger"}
            size="small"
            className={styles.quiet}
            aria-label={copy.label(name)}
            onClick={() => {
              setFailed(null);
              setAsking(true);
            }}
          >
            {copy.open}
          </Button>
        </div>
      )}
      {failed !== null && <Refusal className={styles.error} said={failed} />}
    </>
  );
}
