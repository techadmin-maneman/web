// Erasing a client from their page, when they ask outside the app: on WhatsApp or the phone. A request they made in
// the app is decided in Deletion requests instead, which tells them when it is done, so it is not offered here then.
//
// As in Deletion requests, erasing takes two deliberate steps: the second says what is destroyed and what is kept,
// and waits for ops to confirm the request came from the client's own number. The API refuses while a visit is booked
// or a payment held; ops may then erase all the same, saying they will cancel and refund it by hand today.

import { Button } from "@maneman/ui/Button";
import { Checkbox } from "@maneman/ui/Field";
import { useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import { OpsLink } from "../components/Shell.tsx";
import { clients } from "../content.ts";
import { ErasureLists } from "../deletions/ErasureLists.tsx";
import deletionStyles from "../deletions/deletions.module.css";
import { useAccess } from "../lib/access.ts";
import styles from "./clients.module.css";

const copy = clients.erasure;

type Owed = keyof typeof copy.owed;

/** Where the erasure is: not begun, asked about, refused for what is owed, or failed. */
type Erasing =
  | { readonly step: "closed" }
  | { readonly step: "confirming" }
  | { readonly step: "owed"; readonly code: Owed }
  | { readonly step: "failed"; readonly code: string };

const isOwed = (code: string): code is Owed => code in copy.owed;

/**
 * A step that asks for one tick before its button is usable: the warning and the lists, or what is owed. It takes
 * focus as it opens, because it stands where the button that opened it stood.
 */
function Confirm({
  name,
  message,
  lists,
  check,
  action,
  sending,
  onErase,
  onCancel,
}: {
  name: string;
  message: string;
  lists: boolean;
  check: string;
  action: string;
  sending: boolean;
  onErase: () => void;
  onCancel: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    panel.current?.focus();
  }, []);

  return (
    <div className={deletionStyles.confirm} ref={panel} tabIndex={-1} role="group" aria-label={copy.confirmLabel(name)}>
      <p className={deletionStyles.warning}>{message}</p>
      {lists && <ErasureLists />}
      <Checkbox
        className={deletionStyles.checkLine}
        label={check}
        checked={checked}
        disabled={sending}
        onChange={(event) => {
          setChecked(event.target.checked);
        }}
      />
      <div className={deletionStyles.actions}>
        <Button variant="destructive" size="small" disabled={sending || !checked} onClick={onErase}>
          {sending ? copy.erasing : action}
        </Button>
        <Button variant="outline" size="small" disabled={sending} onClick={onCancel}>
          {copy.cancel}
        </Button>
      </div>
    </div>
  );
}

interface EraseProps {
  readonly clientId: string;
  readonly name: string;
  /** Whether they have a deletion request open, made in the app. */
  readonly requested: boolean;
  readonly onErased: () => void;
}

export function Erase({ clientId, name, requested, onErased }: EraseProps) {
  const mayErase = useAccess().mayCall("POST /api/clients/{id}/erasure");
  const [erasing, setErasing] = useState<Erasing>({ step: "closed" });
  const [sending, setSending] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);

  if (!mayErase || requested) return null;

  const erase = async (settledByHand: boolean) => {
    setSending(true);
    const answer = await api.eraseClient(clientId, settledByHand);
    setSending(false);
    if (answer.ok) {
      onErased();
      return;
    }
    setErasing(isOwed(answer.code) ? { step: "owed", code: answer.code } : { step: "failed", code: answer.code });
  };

  /** Back to the button, and the keyboard with it, rather than to the top of the page. */
  const close = () => {
    setErasing({ step: "closed" });
    requestAnimationFrame(() => opener.current?.focus());
  };

  return (
    <section className={styles.erase} aria-label={copy.title}>
      <h3 className={styles.eraseTitle}>{copy.title}</h3>
      <p className={styles.note}>{copy.note}</p>
      {erasing.step === "confirming" && (
        <Confirm
          name={name}
          message={copy.warning}
          lists
          check={copy.checked}
          action={copy.confirm}
          sending={sending}
          onErase={() => void erase(false)}
          onCancel={close}
        />
      )}
      {erasing.step === "owed" && (
        <Confirm
          key={erasing.code}
          name={name}
          message={copy.owed[erasing.code]}
          lists={false}
          check={copy.settle}
          action={copy.anyway}
          sending={sending}
          onErase={() => void erase(true)}
          onCancel={close}
        />
      )}
      {(erasing.step === "closed" || erasing.step === "failed") && (
        <div className={deletionStyles.actions}>
          <Button
            variant="destructive"
            size="small"
            ref={opener}
            aria-label={copy.openLabel(name)}
            onClick={() => {
              setErasing({ step: "confirming" });
            }}
          >
            {copy.open}
          </Button>
        </div>
      )}
      {erasing.step === "failed" && (
        <p className={deletionStyles.error} role="alert">
          {copy.errors[erasing.code] ?? copy.errors.unknown}
        </p>
      )}
    </section>
  );
}

/** What stands in place of the client's page once they are erased: nothing of theirs is left to show. */
export function Erased() {
  return (
    <section className={styles.erased} aria-label={copy.done.title}>
      <h2 className={styles.name}>{copy.done.title}</h2>
      <p className={styles.note}>{copy.done.body}</p>
      <OpsLink className={styles.erasedBack} to="/clients">
        {copy.done.back}
      </OpsLink>
    </section>
  );
}
