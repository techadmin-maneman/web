// The client's sign-off of a fit (docs/decisions/0254-client-signs-off-the-fit.md), after the after photos and before
// the outcome: the technician asks, and the client answers in their own app, the only place they sign, which this
// screen hears of by reading the card again while it waits. A flag says what isn't right, and once it is put right the
// technician asks again. A client who will not or cannot sign is recorded with why. The ask and the decline go through
// the outbox, so both work with no signal.

import { Button } from "@maneman/ui/Button";
import { ProblemCard } from "@maneman/ui/ProblemCard";
import { Sheet, SheetClose, SheetPanel } from "@maneman/ui/Sheet";
import { TextButton } from "@maneman/ui/TextLink";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { WordsField } from "@maneman/ui/WordsField";
import { useEffect, useId, useState } from "react";
import type { Job } from "../api.ts";
import { signOff as copy, visit } from "../content.ts";
import { JobFailed } from "../frame/JobFailed.tsx";
import { Loading } from "../frame/States.tsx";
import { stamp } from "../lib/when.ts";
import { go, stepPath } from "../route.ts";
import { queue, replay, type Queued } from "../store/outbox.ts";
import { StepFrame } from "./StepFrame.tsx";
import { declinedWhy, heldOf, standingOf, type Standing } from "./sign-off-standing.ts";
import { useStep } from "./useStep.ts";
import styles from "./sign-off.module.css";

/** How often the card is read again while the client is still to answer. */
const LISTEN_MS = 10_000;

/** Sends what the phone queued now, where there is signal; the outbox tries again itself where there is none. */
async function queueAndSend(...args: Parameters<typeof queue>): Promise<void> {
  await queue(...args);
  void replay();
}

/** The client will not sign: why, which ops are given as a Tasks row, and the fit may close. */
function DeclineSheet({ job, onDone, onClose }: { job: Job; onDone: () => void; onClose: () => void }) {
  const titleId = useId();
  const [why, setWhy] = useState("");
  const [busy, once] = useOneAtATime();
  return (
    <Sheet labelledBy={titleId} rises={false} onClose={onClose}>
      <SheetClose onClose={onClose}>{copy.decline.close}</SheetClose>
      <SheetPanel className={styles.panel}>
        <h2 className={styles.title} id={titleId}>
          {copy.decline.title}
        </h2>
        <WordsField label={copy.decline.why} text={why} max={300} onText={setWhy} />
        <Button
          variant="primary"
          size="action"
          busy={busy}
          disabled={why.trim() === ""}
          onClick={() =>
            void once(async () => {
              await queueAndSend("sign_off_declined", job.id, { reason: why.trim() }, job.starts_at);
              onDone();
            })
          }
        >
          {copy.decline.record}
        </Button>
      </SheetPanel>
    </Sheet>
  );
}

/** What the screen says of the sign-off, as it stands, in the words the card has or the phone holds. */
function StandingLine({ job, standing, held }: { job: Job; standing: Standing; held: Queued | undefined }) {
  const signOff = job.sign_off;
  if (standing === "flagged") {
    const what = signOff?.flag_text ?? "";
    return (
      <ProblemCard className={styles.flag} title={copy.flagged}>
        {what === "" ? undefined : what}
      </ProblemCard>
    );
  }
  if (standing === "signed") {
    const at = signOff?.signed_at ?? null;
    return <p className={styles.done}>{at === null ? copy.signed : `${copy.signed} · ${stamp(at)}`}</p>;
  }
  if (standing === "declined") return <p className={styles.done}>{copy.declined(declinedWhy(job, held))}</p>;
  if (standing === "asked") {
    return (
      <div className={styles.waiting} role="status">
        <p className={styles.waitingTitle}>{copy.waiting}</p>
        <p className={styles.line}>{copy.waitingLine}</p>
      </div>
    );
  }
  return <p className={styles.line}>{copy.intro}</p>;
}

/** The way to close a fit the client will not, or cannot, sign in their app: recorded as declined, with why. */
function Decline({ job }: { job: Job }) {
  const [open, setOpen] = useState(false);
  const shut = () => {
    setOpen(false);
  };
  return (
    <div className={styles.ways}>
      <TextButton
        onClick={() => {
          setOpen(true);
        }}
      >
        {copy.declineOpen}
      </TextButton>
      {open && <DeclineSheet job={job} onDone={shut} onClose={shut} />}
    </div>
  );
}

/** The action's words: ask, ask again once a flag is put right, else "Next: Outcome". */
function actionWords(standing: Standing): string | undefined {
  if (standing === "unasked") return copy.ask;
  if (standing === "flagged") return copy.askAgain;
  return undefined;
}

function Signing({
  job,
  queued,
  retry,
  back,
}: {
  job: Job;
  queued: readonly Queued[];
  retry: () => void;
  back: () => void;
}) {
  const held = heldOf(job, queued);
  const standing = standingOf(job, held);
  const [busy, once] = useOneAtATime();
  const listening = standing === "asked" || standing === "flagged";
  useEffect(() => {
    if (!listening) return;
    const timer = setInterval(retry, LISTEN_MS);
    return () => {
      clearInterval(timer);
    };
  }, [listening, retry]);
  const closes = standing === "signed" || standing === "declined";
  const ask = () =>
    once(async () => {
      await queueAndSend("sign_off_request", job.id, {}, job.starts_at);
    });
  return (
    <StepFrame
      title={visit.screens.sign_off}
      action={actionWords(standing)}
      ready={!busy && standing !== "asked"}
      unfinished={copy.unfinished}
      onBack={back}
      onAction={() => {
        if (closes) go(stepPath(job.id, "outcome"));
        else void ask();
      }}
    >
      <StandingLine job={job} standing={standing} held={held} />
      {!closes && <Decline job={job} />}
    </StepFrame>
  );
}

export function SignOff({ id }: { id: string }) {
  const { loaded, retry, queued, back } = useStep(id, "sign_off");
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <JobFailed failed={loaded} onRetry={retry} />;
  return <Signing job={loaded.value} queued={queued} retry={retry} back={back} />;
}
