// Staff's notes on the client, at the right of their page: what to bear in mind, each with who wrote it and when,
// changed or taken off where it stands, and a box beneath to add one. A change made over someone else's reads the page
// again (src/routes/ops/staff-notes.ts).

import { classes } from "@maneman/ui/classes";
import { Panel } from "@maneman/ui/Panel";
import { STAFF_NOTE_MAX_CHARS } from "@rules/policy/staff-notes.ts";
import { plainDate } from "@maneman/web-kit/plain-date";
import { PanelFailed } from "@maneman/ui/States";
import { CancelButton } from "@maneman/ui/CancelButton";
import { Button, RowButton } from "@maneman/ui/Button";
import { Field, TextArea } from "@maneman/ui/Field";
import { useLoad, whenLoaded } from "@maneman/ui/useLoad";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { todayInIndia } from "@maneman/web-kit/dates";
import { errorText } from "@maneman/web-kit/refusal";
import { useCallback, useState } from "react";
import { Refusal } from "@maneman/ui/Refusal";
import { clients } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { staffName } from "../lib/who.ts";
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
        <Button variant="primary" size="small" disabled={busy || body.trim() === ""} onClick={() => void save()}>
          {busy ? copy.saving : copy.save}
        </Button>
        <CancelButton disabled={busy} onClick={onCancel} />
      </div>
    </div>
  );
}

/** The box beneath the notes a new one is written in; Save shows once there is something to save. */
function AddNote({ onSave }: { onSave: (body: string) => Promise<string | null> }) {
  const [body, setBody] = useState("");
  const [refused, setRefused] = useState<string | null>(null);
  const [busy, once] = useOneAtATime();
  const save = () =>
    once(async () => {
      const said = await onSave(body.trim());
      setRefused(said);
      if (said === null) setBody("");
    });
  return (
    <div className={classes(styles.noteForm, styles.addNote)}>
      <Field label={copy.add} labelHidden>
        {(control) => (
          <TextArea
            {...control}
            rows={1}
            placeholder={copy.add}
            value={body}
            maxLength={STAFF_NOTE_MAX_CHARS}
            onChange={(event) => {
              setBody(event.currentTarget.value);
            }}
          />
        )}
      </Field>
      {refused !== null && <Refusal said={refused} />}
      {body.trim() !== "" && (
        <div className={styles.noteActions}>
          <Button variant="primary" size="small" disabled={busy} onClick={() => void save()}>
            {busy ? copy.saving : copy.save}
          </Button>
        </div>
      )}
    </div>
  );
}

/** The notes as last read or written, the note being changed if any, and the box to add one. */
function NoteList({ clientId, initial }: { clientId: string; initial: readonly Note[] }) {
  const mayWrite = useAccess().mayCall("POST /api/clients/{id}/notes");
  const [notes, setNotes] = useState(initial);
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
      {notes.length === 0 && !mayWrite && <p className={styles.openNone}>{copy.none}</p>}
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
                    onClick={() => {
                      setOpen(note.id);
                    }}
                  >
                    {copy.change}
                  </RowButton>
                  <RowButton onClick={() => void takeOff(note.id)}>{copy.takeOff}</RowButton>
                </span>
              )}
            </li>
          ),
        )}
      </ul>
      {mayWrite && open === null && <AddNote onSave={(body) => write(body, null)} />}
    </>
  );
}

function Strip({ clientId }: { clientId: string }) {
  const load = useCallback(() => clientsApi.staffNotes(clientId), [clientId]);
  const [loaded, retry] = useLoad(load);
  return (
    <Panel titleId="staff-notes" title={copy.title}>
      {whenLoaded(loaded, {
        loading: null,
        failed: <PanelFailed onRetry={retry} requestId={loaded.state === "failed" ? loaded.requestId : null} />,
        loaded: (read) => <NoteList clientId={clientId} initial={read.notes} />,
      })}
    </Panel>
  );
}

export function StaffNotes({ clientId }: { clientId: string }) {
  const mayRead = useAccess().mayCall("GET /api/clients/{id}/notes");
  return mayRead ? <Strip clientId={clientId} /> : null;
}
