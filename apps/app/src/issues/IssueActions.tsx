// What a client can do about their report (./IssueScreen.tsx): while it is open, add an update or a photograph, or say
// it is sorted; once resolved, reopen it with what is happening now. Each lands in the same log, which is read again.

import { Button } from "@maneman/ui/Button";
import { Note } from "@maneman/ui/Note";
import { PhotoPick } from "@maneman/ui/PhotoPick";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { WordsField } from "@maneman/ui/WordsField";
import { PROBLEM_MAX_CHARS, PROBLEM_PHOTOS_MAX } from "@rules/policy/problems.ts";
import { useState } from "react";
import { api, type Issue } from "../api.ts";
import { describedBy, Missing } from "@maneman/ui/Missing";
import { issues, missing } from "../content.ts";
import { small } from "./RaisePhotos.tsx";
import styles from "./issue.module.css";

type Answer = { readonly ok: true } | { readonly ok: false; readonly code: string };

/** Why an update, a reopening or a photo did not go through, as the client is told it. */
function refusal(code: string | null): string {
  const copy = issues.page;
  if (code === "rate_limited") return copy.limited;
  if (code === "photos_full") return copy.photosFull;
  return code === "unread" ? copy.photoUnread : copy.failed;
}

/** The photo made small enough to send; null for one the browser cannot read. */
const readable = (file: File): Promise<Blob | null> => small(file).catch(() => null);

/**
 * A photo added now: the raise's "a photo didn't upload", carried in the address (?photos=failed), goes from it, and so
 * from the page, which is read again.
 */
const photoAdded = (onChanged: () => void) => () => {
  window.history.replaceState(window.history.state, "", window.location.pathname);
  onChanged();
};

/** A photograph sent to the report as soon as it is picked. */
function AddPhoto(props: { reference: string; onSent: () => void; onFailed: (code: string | null) => void }) {
  const [busy, once] = useOneAtATime();
  const send = (file: File | undefined) =>
    once(async () => {
      if (file === undefined) return;
      const photo = await readable(file);
      if (photo === null) {
        props.onFailed("unread");
        return;
      }
      const sent = await api.problemPhoto(props.reference, photo).catch(() => null);
      if (sent?.ok === true) props.onSent();
      else props.onFailed(sent?.code ?? null);
    });
  return (
    <PhotoPick look="words" label={issues.page.addPhoto} disabled={busy} onPick={(files) => void send(files[0])}>
      {issues.page.addPhoto}
    </PhotoPick>
  );
}

/** A report Care resolved: that it is, and the way to say it is happening again. */
function Resolved({ onReopen }: { onReopen: () => void }) {
  return (
    <div className={styles.actions}>
      <Note>{issues.page.resolved}</Note>
      <Button variant="outline" size="action" onClick={onReopen}>
        {issues.page.again}
      </Button>
    </div>
  );
}

/** Send the words, or reopen with them; and, while open, say it is sorted. What is missing beneath. */
function Buttons(props: {
  reopening: boolean;
  busy: boolean;
  empty: boolean;
  onSend: () => void;
  onSorted: () => void;
}) {
  const copy = issues.page;
  const wanted = props.reopening ? missing.reopenWords : missing.updateWords;
  return (
    <>
      <div className={styles.buttons}>
        <Button
          variant="primary"
          size="action"
          disabled={props.empty || props.busy}
          aria-describedby={describedBy("issue-words", props.empty)}
          onClick={props.onSend}
        >
          {props.reopening ? copy.reopen : copy.send}
        </Button>
        {!props.reopening && (
          <Button variant="outline" size="action" disabled={props.busy} onClick={props.onSorted}>
            {copy.sorted}
          </Button>
        )}
      </div>
      <Missing id="issue-words" what={props.empty ? wanted : null} />
    </>
  );
}

export function IssueActions({
  issue,
  reference,
  onChanged,
}: {
  issue: Issue;
  reference: string;
  onChanged: () => void;
}) {
  const copy = issues.page;
  const [text, setText] = useState("");
  const [reopening, setReopening] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, once] = useOneAtATime();
  const act = (call: () => Promise<Answer>) =>
    once(async () => {
      const answer = await call();
      if (!answer.ok) {
        setProblem(refusal(answer.code));
        return;
      }
      setText("");
      setReopening(false);
      setProblem(null);
      onChanged();
    });
  const words = text.trim();
  const failed = (code: string | null) => {
    setProblem(refusal(code));
  };
  if (issue.state === "resolved" && !reopening)
    return (
      <Resolved
        onReopen={() => {
          setReopening(true);
        }}
      />
    );
  return (
    <div className={styles.actions}>
      {issue.photos > 0 && <p className={styles.raised}>{copy.photos(issue.photos)}</p>}
      {!reopening && issue.photos < PROBLEM_PHOTOS_MAX && (
        <AddPhoto reference={reference} onSent={photoAdded(onChanged)} onFailed={failed} />
      )}
      <WordsField
        label={reopening ? copy.againLabel : copy.update}
        text={text}
        max={PROBLEM_MAX_CHARS}
        onText={setText}
      />
      <Buttons
        reopening={reopening}
        busy={busy}
        empty={words === ""}
        onSend={() =>
          void act(() => (reopening ? api.reopenProblem(reference, words) : api.updateProblem(reference, words)))
        }
        onSorted={() => void act(() => api.problemSorted(reference))}
      />
      {problem !== null && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
