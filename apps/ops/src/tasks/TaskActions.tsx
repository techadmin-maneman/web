// What ops do with a task on the Tasks board itself (docs/decisions/0092-task-owners.md): take it, give it to
// another member of staff who has signed in to the console, hand it back, and, for a visit left partly done alone,
// close it without a follow-up, with why. The design draws each task's owner and none of these; they sit beneath the
// task's own lines, as the way to where it is decided does.

import { REASON_MAX_CHARS } from "../../../../src/policy/decision-reasons.ts";
import { errorText } from "@maneman/web-kit/refusal";
import { Button } from "@maneman/ui/Button";
import { Field, TextArea } from "@maneman/ui/Field";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { useRef, useState, type RefObject } from "react";
import { api, type ClosableGroup, type Task, type TaskGroup } from "../api.ts";
import { tasks } from "../content.ts";
import styles from "./tasks.module.css";

type Group = TaskGroup["group"];

/** The group as the close route names it, for the one group whose tasks ops may close; null for any other. */
const closableAs = (group: Group): ClosableGroup | null => (group === "partial_visit" ? group : null);

/** A label every row repeats, with whose it is said to a screen reader. */
const Named = ({ label, subject }: { label: string; subject: string }) => (
  <>
    {label}
    <VisuallyHidden>{` · ${subject}`}</VisuallyHidden>
  </>
);

/** Which of the row's forms is open. */
type Open = "none" | "give" | "close";

function GiveForm({
  owner,
  me,
  staff,
  subject,
  busy,
  onGive,
  onCancel,
}: {
  owner: string | null;
  me: string | null;
  staff: readonly string[];
  subject: string;
  busy: boolean;
  onGive: (to: string | null) => void;
  onCancel: () => void;
}) {
  const others = staff.filter((email) => email !== owner);
  const [chosen, setChosen] = useState(others[0] ?? "");
  const copy = tasks.owner;
  return (
    <div className={styles.form}>
      <Field label={<Named label={copy.giveTo} subject={subject} />}>
        {(control) => (
          <select
            {...control}
            className={styles.select}
            // The list stands where the button that asked for it stood, so the keyboard goes to it.
            autoFocus
            value={chosen}
            disabled={busy}
            onChange={(event) => {
              setChosen(event.currentTarget.value);
            }}
          >
            {others.map((email) => (
              <option key={email} value={email}>
                {email === me ? copy.you(email) : email}
              </option>
            ))}
            {owner !== null && <option value="">{copy.giveNobody}</option>}
          </select>
        )}
      </Field>
      <div className={styles.formActions}>
        <Button
          variant="outline"
          size="small"
          busy={busy}
          onClick={() => {
            onGive(chosen === "" ? null : chosen);
          }}
        >
          {busy ? copy.saving : copy.save}
        </Button>
        <Button variant="outline" size="small" disabled={busy} onClick={onCancel}>
          {copy.cancel}
        </Button>
      </div>
    </div>
  );
}

function CloseForm({
  subject,
  busy,
  onClose,
  onCancel,
}: {
  subject: string;
  busy: boolean;
  onClose: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const copy = tasks.close;
  return (
    <div className={styles.form}>
      <Field label={<Named label={copy.label} subject={subject} />} hint={copy.hint}>
        {(control) => (
          <TextArea
            {...control}
            className={styles.reason}
            autoFocus
            maxLength={REASON_MAX_CHARS}
            value={reason}
            disabled={busy}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        )}
      </Field>
      <div className={styles.formActions}>
        <Button
          variant="outline"
          size="small"
          busy={busy}
          disabled={reason.trim() === ""}
          onClick={() => {
            onClose(reason.trim());
          }}
        >
          {busy ? copy.closing : copy.confirm}
        </Button>
        <Button variant="outline" size="small" disabled={busy} onClick={onCancel}>
          {copy.cancel}
        </Button>
      </div>
    </div>
  );
}

/** A small action beneath the task's lines; each row's say whose they are to a screen reader. */
function Act({
  label,
  subject,
  onClick,
  actRef,
  expanded,
}: {
  label: string;
  subject: string;
  onClick: () => void;
  actRef?: RefObject<HTMLButtonElement | null>;
  expanded?: boolean;
}) {
  return (
    <button type="button" className={styles.act} ref={actRef} aria-expanded={expanded} onClick={onClick}>
      <Named label={label} subject={subject} />
    </button>
  );
}

export function TaskActions({
  group,
  task,
  subject,
  owner,
  me,
  staff,
  mayOwn,
  closable,
  onOwner,
  onClosed,
}: {
  group: Group;
  task: Task;
  /** Who or what the task heads with, which each action names to a screen reader. */
  subject: string;
  owner: string | null;
  /** Who is signed in; null while it is not known, when a task cannot be taken. */
  me: string | null;
  staff: readonly string[];
  mayOwn: boolean;
  closable: boolean;
  onOwner: (owner: string | null) => void;
  onClosed: () => void;
}) {
  const [open, setOpen] = useState<Open>("none");
  const [failed, setFailed] = useState<{ readonly code: string; readonly closing: boolean } | null>(null);
  const [busy, once] = useOneAtATime();
  const mineButton = useRef<HTMLButtonElement>(null);
  const giveButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const closing = closable ? closableAs(group) : null;
  const mine = mayOwn && owner !== null && owner === me;
  const canTake = mayOwn && me !== null && staff.includes(me);
  // Someone to give it to, or, for a task that is someone's, nobody.
  const canGive = mayOwn && (owner !== null || staff.length > 0);

  /** Back to the button that opened a form, rather than to the top of the page. */
  const backTo = (button: RefObject<HTMLButtonElement | null>) => {
    setOpen("none");
    requestAnimationFrame(() => button.current?.focus());
  };

  const makeOwner = (next: string | null, back: RefObject<HTMLButtonElement | null>) =>
    once(async () => {
      setFailed(null);
      const answer = await api.setTaskOwner(group, task.id, next);
      if (!answer.ok) {
        setFailed({ code: answer.code, closing: false });
        return;
      }
      onOwner(answer.body.owner);
      backTo(back);
    });

  const close = (reason: string) =>
    once(async () => {
      if (closing === null) return;
      setFailed(null);
      const answer = await api.closeTask(closing, task.id, reason);
      if (answer.ok) onClosed();
      else setFailed({ code: answer.code, closing: true });
    });

  const errors = failed?.closing === true ? tasks.close.errors : tasks.owner.errors;
  return (
    <>
      <span className={styles.ownerActs}>
        {mine && (
          <Act
            label={tasks.owner.handBack}
            subject={subject}
            actRef={mineButton}
            onClick={() => void makeOwner(null, mineButton)}
          />
        )}
        {!mine && canTake && (
          <Act
            label={tasks.owner.take}
            subject={subject}
            actRef={mineButton}
            onClick={() => void makeOwner(me, mineButton)}
          />
        )}
        {canGive && (
          <Act
            label={tasks.owner.give}
            subject={subject}
            actRef={giveButton}
            expanded={open === "give"}
            onClick={() => {
              setOpen("give");
            }}
          />
        )}
        {closing !== null && (
          <Act
            label={tasks.close.open}
            subject={subject}
            actRef={closeButton}
            expanded={open === "close"}
            onClick={() => {
              setOpen("close");
            }}
          />
        )}
      </span>
      {open === "give" && (
        <GiveForm
          owner={owner}
          me={me}
          staff={staff}
          subject={subject}
          busy={busy}
          onGive={(to) => void makeOwner(to, giveButton)}
          onCancel={() => {
            backTo(giveButton);
          }}
        />
      )}
      {open === "close" && (
        <CloseForm
          subject={subject}
          busy={busy}
          onClose={(reason) => void close(reason)}
          onCancel={() => {
            backTo(closeButton);
          }}
        />
      )}
      {failed !== null && (
        <span className={styles.error} role="alert">
          {errorText(errors, { code: failed.code })}
        </span>
      )}
    </>
  );
}
