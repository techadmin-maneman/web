// Staff's notes on the client, under the head of their page: what to bear in mind, each with who wrote it and when,
// changed or taken off where it stands. A change made over someone else's reads the page again
// (src/routes/ops/staff-notes.ts).

import { STAFF_NOTE_MAX_CHARS } from "@rules/policy/staff-notes.ts";
import { Button, RowButton } from "@maneman/ui/Button";
import { Field, TextArea } from "@maneman/ui/Field";
import { typeLook } from "@maneman/ui/type";
import { useLoad, whenLoaded } from "@maneman/ui/useLoad";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { fullDate, todayInIndia } from "@maneman/web-kit/dates";
import { errorText } from "@maneman/web-kit/refusal";
import { useCallback, useState } from "react";
import { Refusal } from "../components/Refusal.tsx";
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
        <Button variant="outline" size="small" disabled={busy} onClick={onCancel}>
          {copy.cancel}
        </Button>
      </div>
    </div>
  );
}

/** The notes as last read or written, and the box open for a new note or the note being changed, if any. */
function NoteList({ clientId, initial }: { clientId: string; initial: readonly Note[] }) {
  const mayWrite = useAccess().mayCall("POST /api/clients/{id}/notes");
  const [notes, setNotes] = useState(initial);
  /** The box open: for a new note, for the note of that ID, or none. */
  const [open, setOpen] = useState<{ readonly note: string | null } | null>(null);
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
      {notes.length === 0 && open === null && <p className={styles.openNone}>{copy.none}</p>}
      <ul className={styles.notes}>
        {notes.map((note) =>
          open?.note === note.id ? (
            <li key={note.id}>
              <NoteForm initial={note.body} onSave={(body) => write(body, note.id)} onCancel={close} />
            </li>
          ) : (
            <li key={note.id} className={styles.note}>
              <p className={styles.noteBody}>{note.body}</p>
              <span className={styles.noteBy}>
                {copy.by(staffName(note.written_by), fullDate(todayInIndia(Date.parse(note.written_at))))}
              </span>
              {mayWrite && (
                <span className={styles.noteActions}>
                  <RowButton
                    onClick={() => {
                      setOpen({ note: note.id });
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
      {open !== null && open.note === null && (
        <NoteForm initial="" onSave={(body) => write(body, null)} onCancel={close} />
      )}
      {mayWrite && open === null && (
        <RowButton
          onClick={() => {
            setOpen({ note: null });
          }}
        >
          {copy.add}
        </RowButton>
      )}
    </>
  );
}

function Strip({ clientId }: { clientId: string }) {
  const load = useCallback(() => clientsApi.staffNotes(clientId), [clientId]);
  const [loaded] = useLoad(load);
  return (
    <section className={styles.notesStrip} aria-labelledby="staff-notes">
      <h3 className={typeLook("title-4", styles.sectionTitle)} id="staff-notes">
        {copy.title}
      </h3>
      {whenLoaded(loaded, {
        loading: null,
        failed: <p className={styles.openNone}>{copy.failed}</p>,
        loaded: (read) => <NoteList clientId={clientId} initial={read.notes} />,
      })}
    </section>
  );
}

export function StaffNotes({ clientId }: { clientId: string }) {
  const mayRead = useAccess().mayCall("GET /api/clients/{id}/notes");
  return mayRead ? <Strip clientId={clientId} /> : null;
}
