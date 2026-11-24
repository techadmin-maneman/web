// A deletion request's decision, in its drawer (./DeletionsScreen.tsx): Delete or Reject, each asked about before it
// is sent. Erasing cannot be undone, so it is confirmed against what it destroys and the client's own number; a
// rejection needs its reason.

import { ACTION_ICONS } from "@maneman/brand/action-icons";
import { REASON_MAX_CHARS } from "@rules/policy/decision-reasons.ts";
import { Button } from "@maneman/ui/Button";
import { CancelButton } from "@maneman/ui/CancelButton";
import { Checkbox, Field, TextArea } from "@maneman/ui/Field";
import { useFocusOnMount } from "@maneman/ui/useFocusOnMount";
import { useState, type RefObject } from "react";
import { type DeletionRequest } from "../api.ts";
import { deletions } from "../content.ts";
import styles from "./deletions-screen.module.css";
import shared from "./erasure.module.css";
import { ErasureLists } from "./ErasureLists.tsx";

export type Choice = "delete" | "reject";

const copy = deletions.queue;

/**
 * The second of the two steps: what the erasure destroys, what it leaves, and
 * the check that the request came from the client. It takes focus as it opens,
 * because it stands where the button that opened it stood.
 */
export function ConfirmDelete({
  request,
  sending,
  onDelete,
  onCancel,
}: {
  request: DeletionRequest;
  sending: boolean;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const panel = useFocusOnMount<HTMLDivElement>();
  const [checked, setChecked] = useState(false);
  const [chatDeleted, setChatDeleted] = useState(false);

  return (
    <div className={shared.confirm} ref={panel} tabIndex={-1} role="group" aria-label={copy.confirmLabel(request.name)}>
      <p className={shared.warning}>{copy.warning}</p>
      <ErasureLists />
      <Checkbox
        className={shared.checkLine}
        label={copy.checked}
        checked={checked}
        disabled={sending}
        onChange={(event) => {
          setChecked(event.target.checked);
        }}
      />
      <Checkbox
        className={shared.checkLine}
        label={copy.chatDeleted}
        checked={chatDeleted}
        disabled={sending}
        onChange={(event) => {
          setChatDeleted(event.target.checked);
        }}
      />
      <div className={shared.actions}>
        <Button
          icon={ACTION_ICONS.trash}
          variant="destructive"
          size="small"
          disabled={sending || !checked || !chatDeleted}
          onClick={onDelete}
        >
          {sending ? copy.deleting : copy.confirm(request.name)}
        </Button>
        <CancelButton disabled={sending} onClick={onCancel} />
      </div>
    </div>
  );
}

/** Why the request is rejected, which the route will not take without, and the buttons that send it or go back. */
export function RejectReason(props: {
  reason: string;
  sending: boolean;
  onReason: (reason: string) => void;
  onReject: () => void;
  onCancel: () => void;
}) {
  const { reason, sending } = props;
  // The field stands where the button that asked for it stood, so the keyboard goes to it, once the drawer has opened.
  const box = useFocusOnMount<HTMLTextAreaElement>();
  return (
    <div className={shared.reason}>
      <Field label={copy.reason.label}>
        {(control) => (
          <TextArea
            {...control}
            ref={box}
            className={styles.reasonField}
            maxLength={REASON_MAX_CHARS}
            value={reason}
            onChange={(event) => {
              props.onReason(event.target.value);
            }}
          />
        )}
      </Field>
      <div className={shared.actions}>
        <Button
          icon={ACTION_ICONS.circleX}
          variant="outline"
          size="small"
          disabled={sending || reason.trim() === ""}
          onClick={props.onReject}
        >
          {sending ? copy.rejecting : copy.reason.confirm}
        </Button>
        <CancelButton disabled={sending} onClick={props.onCancel} />
      </div>
    </div>
  );
}

/** The two decisions in the drawer, each asked about before it is sent. */
export function Choices(props: {
  readonly name: string;
  readonly openers: Readonly<Record<Choice, RefObject<HTMLButtonElement | null>>>;
  readonly onAsk: (choice: Choice) => void;
}) {
  return (
    <div className={shared.actions}>
      <Button
        icon={ACTION_ICONS.trash}
        variant="destructive"
        size="small"
        ref={props.openers.delete}
        aria-label={copy.deleteLabel(props.name)}
        onClick={() => {
          props.onAsk("delete");
        }}
      >
        {copy.delete}
      </Button>
      <Button
        icon={ACTION_ICONS.circleX}
        variant="outline"
        size="small"
        ref={props.openers.reject}
        aria-label={copy.rejectLabel(props.name)}
        onClick={() => {
          props.onAsk("reject");
        }}
      >
        {copy.reject}
      </Button>
    </div>
  );
}
