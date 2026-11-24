// Staff's notes on the client, at the right of their page: what to bear in mind, each with who wrote it and when,
// changed or taken off where it stands. Add, in the card's head, opens a drawer to write one. A change made over
// someone else's reads the page again (src/routes/ops/staff-notes.ts).

import { ACTION_ICONS } from "@maneman/brand/action-icons";
import { AddForm } from "@maneman/ui/AddForm";
import { Panel } from "@maneman/ui/Panel";
import { STAFF_NOTE_MAX_CHARS } from "@rules/policy/staff-notes.ts";
import { plainDate } from "@maneman/web-kit/plain-date";
import { PanelFailed } from "@maneman/ui/States";
import { CancelButton } from "@maneman/ui/CancelButton";
import { Button, RowButton } from "@maneman/ui/Button";
import { EmptyState } from "@maneman/ui/EmptyState";
import { Field, TextArea } from "@maneman/ui/Field";
import { FormDrawer } from "@maneman/ui/FormDrawer";
import { TextButton } from "@maneman/ui/TextLink";
import { Toast } from "@maneman/ui/Toast";
import { useLoad, whenLoaded } from "@maneman/ui/useLoad";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { todayInIndia } from "@maneman/web-kit/dates";
import { errorText } from "@maneman/web-kit/refusal";
import { useCallback, useRef, useState } from "react";
import { Refusal } from "@maneman/ui/Refusal";
import { clients } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { staffName } from "../lib/who.ts";
import form from "@maneman/ui/forms.module.css";
import styles from "./clients.module.css";
import { clientsApi } from "./clients-api.ts";

const copy = clients.notes;

interface Note {
  readonly id: string;
  readonly body: string;
  readonly written_by: string;
  readonly written_at: string;
}

/** The box a note is written or changed in, with Save and Cancel. */
function NoteForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (body: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [body, setBody] = useState(initial);
  const [refused, setRefused] = useState<string | null>(null);
  const [busy, once] = useOneAtATime();
  const save = () =>
    once(async () => {
      setRefused(await onSave(body.trim()));
    });
  return (
    <div className={styles.noteForm}>
      <Field label={copy.label}>
        {(control) => (
          <TextArea
            {...control}
            autoFocus
            value={body}
            maxLength={STAFF_NOTE_MAX_CHARS}
            onChange={(event) => {
              setBody(event.currentTarget.value);
            }}
          />
        )}
      </Field>
      {refused !== null && <Refusal said={refused} />}
      <div className={styles.noteActions}>
        <Button icon={ACTION_ICONS.check} variant="primary" size="small" busy={busy} onClick={() => void save()}>
          {busy ? copy.saving : copy.save}
        </Button>
        <CancelButton disabled={busy} onClick={onCancel} />
      </div>
    </div>
  );
}

/** The drawer's form a note is written in, with Add note and Cancel; an empty one is refused on its box. */
function AddNoteForm(props: { clientId: string; onAdded: (notes: readonly Note[]) => void; onCancel: () => void }) {
  const [body, setBody] = useState("");
  return (
    <AddForm
      title={copy.formTitle}
      words={{ add: copy.addNote }}
      errors={copy.errors}
      boxes={["body"]}
      send={() => clientsApi.writeStaffNote(props.clientId, body.trim(), null)}
      onAdded={(read) => {
        props.onAdded(read.notes);
      }}
      onCancel={props.onCancel}
    >
      <div className={form.fields}>
        <Field label={copy.label} className={form.field} box="body">
          {(control) => (
            <TextArea
              {...control}
              autoFocus
              rows={3}
              value={body}
              maxLength={STAFF_NOTE_MAX_CHARS}
              onChange={(event) => {
                setBody(event.currentTarget.value);
              }}
            />
          )}
        </Field>
      </div>
    </AddForm>
  );
}

/** The notes as last read or written, the note being changed if any, and the box to add one. */
function NoteList(props: {
  clientId: string;
  initial: readonly Note[];
  mayWrite: boolean;
  adding: boolean;
  onAdded: () => void;
  onCancel: () => void;
}) {
  const { clientId, mayWrite } = props;
  const [notes, setNotes] = useState(props.initial);
  /** The note being changed, by its ID, or none. */
  const [open, setOpen] = useState<string | null>(null);
  const write = async (body: string, replaces: string | null) => {
    const answer = await clientsApi.writeStaffNote(clientId, body, replaces);
    if (!answer.ok) return errorText(copy.errors, answer);
    setNotes(answer.body.notes);
    setOpen(null);
    return null;
  };
  const takeOff = async (note: string) => {
    const answer = await clientsApi.takeOffStaffNote(clientId, note);
    if (answer.ok) setNotes(answer.body.notes);
  };
  const close = () => {
    setOpen(null);
  };
  return (
    <>
      {notes.length === 0 && <EmptyState look="panel" line={copy.none} />}
      <ul className={styles.notes}>
        {notes.map((note) =>
          open === note.id ? (
            <li key={note.id}>
              <NoteForm initial={note.body} onSave={(body) => write(body, note.id)} onCancel={close} />
            </li>
          ) : (
            <li key={note.id} className={styles.noteItem}>
              <p className={styles.noteBody}>{note.body}</p>
              <span className={styles.noteBy}>
                {copy.by(staffName(note.written_by), plainDate(todayInIndia(Date.parse(note.written_at))))}
              </span>
              {mayWrite && (
                <span className={styles.noteActions}>
                  <RowButton
                    icon={ACTION_ICONS.pencil}
                    onClick={() => {
                      setOpen(note.id);
                    }}
                  >
                    {copy.change}
                  </RowButton>
                  <RowButton icon={ACTION_ICONS.trash} onClick={() => void takeOff(note.id)}>
                    {copy.takeOff}
                  </RowButton>
                </span>
              )}
            </li>
          ),
        )}
      </ul>
      {props.adding && (
        <FormDrawer title={copy.formTitle} onClose={props.onCancel}>
          <AddNoteForm
            clientId={clientId}
            onAdded={(read) => {
              setNotes(read);
              props.onAdded();
            }}
            onCancel={props.onCancel}
          />
        </FormDrawer>
      )}
    </>
  );
}

function Strip({ clientId }: { clientId: string }) {
  const load = useCallback(() => clientsApi.staffNotes(clientId), [clientId]);
  const [loaded, retry] = useLoad(load);
  const mayWrite = useAccess().mayCall("POST /api/clients/{id}/notes");
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  // The drawer closed, the keyboard goes back to Add.
  const stop = () => {
    setAdding(false);
    requestAnimationFrame(() => opener.current?.focus());
  };
  return (
    <Panel
      titleId="staff-notes"
      title={copy.title}
      actions={
        mayWrite &&
        loaded.state === "loaded" && (
          <TextButton
            icon={ACTION_ICONS.plus}
            compact
            ref={opener}
            aria-label={copy.add}
            onClick={() => {
              setAdded(false);
              setAdding(true);
            }}
          >
            {copy.open}
          </TextButton>
        )
      }
    >
      {whenLoaded(loaded, {
        loading: null,
        failed: <PanelFailed onRetry={retry} requestId={loaded.state === "failed" ? loaded.requestId : null} />,
        loaded: (read) => (
          <NoteList
            clientId={clientId}
            initial={read.notes}
            mayWrite={mayWrite}
            adding={adding}
            onAdded={() => {
              setAdded(true);
              stop();
            }}
            onCancel={stop}
          />
        ),
      })}
      {added && <Toast>{copy.added}</Toast>}
    </Panel>
  );
}

export function StaffNotes({ clientId }: { clientId: string }) {
  const mayRead = useAccess().mayCall("GET /api/clients/{id}/notes");
  return mayRead ? <Strip clientId={clientId} /> : null;
}
