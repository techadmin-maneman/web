// The client's sign-off of a fit, on Home's card while the technician asks for it (design/client-redesign, the sign-off
// panel; docs/decisions/0254-client-signs-off-the-fit.md): the three checks, then signed, or what isn't right, which
// reaches the technician's phone for them to put right and ask again. Only ever in the client's own app.

import { Button } from "@maneman/ui/Button";
import { CheckRow } from "@maneman/ui/CheckRow";
import { textLinkLook } from "@maneman/ui/TextLink";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { WordsField } from "@maneman/ui/WordsField";
import { indiaClock } from "@maneman/web-kit/dates";
import { FLAG_MAX_CHARS } from "@rules/policy/sign-off.ts";
import { useState } from "react";
import { api, type VisitSummary } from "../api.ts";
import { live } from "../content.ts";
import { AppLink } from "../frame/Shell.tsx";
import { useSession } from "../session.ts";
import styles from "./live-card.module.css";

type Checks = { hairline: boolean; blend: boolean; secure: boolean };
type Answer = Parameters<typeof api.signOff>[1];
const CHECKS = ["hairline", "blend", "secure"] as const;

function Flagged({ technician, words }: { technician: string; words: string | null }) {
  const copy = live.signOff;
  return (
    <div className={styles.panel}>
      <h3 className={styles.panelTitle}>{copy.sent(technician)}</h3>
      <p className={styles.panelLine}>
        {words === null ? "" : `“${words}”. `}
        {copy.sentLine(technician)}
      </p>
    </div>
  );
}

/** What isn't right, in the client's words, sent to the technician; or back to the checks. */
function NotRight(props: { technician: string; busy: boolean; onSend: (words: string) => void; onBack: () => void }) {
  const copy = live.signOff;
  const [words, setWords] = useState("");
  return (
    <>
      <WordsField label={copy.whatsWrong} text={words} max={FLAG_MAX_CHARS} onText={setWords} />
      <Button
        variant="primary"
        size="action"
        disabled={words.trim() === "" || props.busy}
        onClick={() => {
          props.onSend(words.trim());
        }}
      >
        {copy.send(props.technician)}
      </Button>
      <Button variant="quiet" size="control" onClick={props.onBack}>
        {copy.cancel}
      </Button>
    </>
  );
}

export function SignOffPanel({ visit, technician }: { visit: VisitSummary; technician: string }) {
  const { me, refresh } = useSession();
  const copy = live.signOff;
  const [checks, setChecks] = useState<Checks>({ hairline: false, blend: false, secure: false });
  const [flagging, setFlagging] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, once] = useOneAtATime();
  const signOff = visit.sign_off;
  if (signOff === null) return null;
  if (signOff.state === "flagged") return <Flagged technician={technician} words={signOff.flag_text} />;
  if (signOff.state !== "asked") return null;
  const answer = (body: Answer) =>
    once(async () => {
      const answered = await api.signOff(visit.id, body);
      setFailed(!answered.ok);
      if (answered.ok) refresh();
    });
  return (
    <div className={styles.panel}>
      <h3 className={styles.panelTitle}>{copy.check(technician)}</h3>
      <AppLink className={textLinkLook({ className: styles.photos })} to={`/visits/${visit.id}`}>
        {copy.photos}
      </AppLink>
      {CHECKS.map((check) => (
        <CheckRow
          key={check}
          done={checks[check]}
          onToggle={() => {
            setChecks({ ...checks, [check]: !checks[check] });
          }}
        >
          {copy.checks[check]}
        </CheckRow>
      ))}
      {flagging ? (
        <NotRight
          technician={technician}
          busy={busy}
          onSend={(words) => void answer({ result: "flagged", checks, flag_text: words })}
          onBack={() => {
            setFlagging(false);
          }}
        />
      ) : (
        <>
          <Button
            variant="primary"
            size="action"
            disabled={!CHECKS.every((check) => checks[check]) || busy}
            onClick={() => void answer({ result: "signed", checks })}
          >
            {copy.happy}
          </Button>
          <Button
            variant="quiet"
            size="control"
            onClick={() => {
              setFlagging(true);
            }}
          >
            {copy.notRight}
          </Button>
        </>
      )}
      <p className={styles.panelNote}>
        {visit.type === "first_fit" ? copy.guarantee(me.guarantee_days) : copy.recorded}
      </p>
      {failed && (
        <p className={styles.problem} role="alert">
          {copy.failed}
        </p>
      )}
    </div>
  );
}

/** "Signed off by you, 12:48 pm", once signed. */
export const signedLine = (visit: VisitSummary): string | null =>
  visit.sign_off?.state === "signed" && visit.sign_off.signed_at !== null
    ? live.signOff.signed(indiaClock(visit.sign_off.signed_at))
    : null;
