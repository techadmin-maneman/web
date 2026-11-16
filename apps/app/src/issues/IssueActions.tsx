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
import { issues } from "../content.ts";
import { small } from "./RaisePhotos.tsx";
import styles from "./issue.module.css";

/** A photograph sent to the report as soon as it is picked. */
function AddPhoto({ reference, onSent, onFailed }: { reference: string; onSent: () => void; onFailed: () => void }) {
  const [busy, once] = useOneAtATime();
  const send = (file: File | undefined) =>
    once(async () => {
      if (file === undefined) return;
      const sent = await api.problemPhoto(reference, await small(file)).catch(() => null);
      if (sent?.ok === true) onSent();
      else onFailed();
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
  const act = (call: () => Promise<{ readonly ok: boolean }>) =>
    once(async () => {
      if (!(await call()).ok) {
        setProblem(copy.failed);
        return;
      }
      setText("");
      setReopening(false);
      setProblem(null);
      onChanged();
    });
  const words = text.trim();
  const failed = () => {
    setProblem(copy.failed);
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
        <AddPhoto reference={reference} onSent={onChanged} onFailed={failed} />
      )}
      <WordsField
        label={reopening ? copy.againLabel : copy.update}
        text={text}
        max={PROBLEM_MAX_CHARS}
        onText={setText}
      />
      <div className={styles.buttons}>
        <Button
          variant="primary"
          size="action"
          disabled={words === "" || busy}
          onClick={() =>
            void act(() => (reopening ? api.reopenProblem(reference, words) : api.updateProblem(reference, words)))
          }
        >
          {reopening ? copy.reopen : copy.send}
        </Button>
        {!reopening && (
          <Button
            variant="outline"
            size="action"
            disabled={busy}
            onClick={() => void act(() => api.problemSorted(reference))}
          >
            {copy.sorted}
          </Button>
        )}
      </div>
      {problem !== null && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
