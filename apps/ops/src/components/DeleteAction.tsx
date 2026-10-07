// A Delete button for something added by mistake: pressed, it asks once, and only the second press deletes. A refusal
// is said in the caller's words, as why it stays and what to do instead (an in_use is the usual one).

import { Button } from "@maneman/ui/Button";
import { useState } from "react";
import { deleting } from "../content.ts";
import styles from "./delete-action.module.css";

/** What the button, its question and its confirmation say. */
export interface DeleteWords {
  readonly open: string;
  readonly label: (name: string) => string;
  readonly warning: (name: string) => string;
  readonly confirm: string;
  readonly sending: string;
  readonly cancel: string;
}

type Answer<Body> = { readonly ok: true; readonly body: Body } | { readonly ok: false; readonly code: string };

export function DeleteAction<Body>({
  name,
  words: copy = deleting,
  send,
  refusal,
  onDeleted,
  onCancel,
}: {
  /** What is deleted, as the page names it. */
  readonly name: string;
  /** Its own words, where what goes is not gone for good, as a member of staff taken off the list. */
  readonly words?: DeleteWords;
  readonly send: () => Promise<Answer<Body>>;
  /** Why the API refused, in the page's own words. */
  readonly refusal: (code: string) => string;
  readonly onDeleted: (body: Body) => void | Promise<void>;
  /** Where a row's own Delete opened it: it opens asking, and Cancel closes it. */
  readonly onCancel?: () => void;
}) {
  const [asking, setAsking] = useState(onCancel !== undefined);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const remove = async () => {
    setSending(true);
    setFailed(null);
    const answer = await send();
    setSending(false);
    if (!answer.ok) {
      // A row's own Delete keeps its panel, with the reason and its Cancel; the page's goes back to its button.
      if (onCancel === undefined) setAsking(false);
      setFailed(refusal(answer.code));
      return;
    }
    await onDeleted(answer.body);
  };

  return (
    <>
      {asking ? (
        <div className={styles.asking}>
          <p className={styles.warning}>{copy.warning(name)}</p>
          <div className={styles.actions}>
            <Button
              variant="danger"
              size="small"
              className={styles.quiet}
              disabled={sending}
              onClick={() => void remove()}
            >
              {sending ? copy.sending : copy.confirm}
            </Button>
            <Button
              variant="outline"
              size="small"
              className={styles.quiet}
              disabled={sending}
              onClick={() => {
                setAsking(false);
                onCancel?.();
              }}
            >
              {copy.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.actions}>
          <Button
            variant="outline"
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
      {failed !== null && (
        <p className={styles.error} role="alert">
          {failed}
        </p>
      )}
    </>
  );
}
