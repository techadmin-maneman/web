// The client's sign-off of a fit (docs/decisions/0254-client-signs-off-the-fit.md), after the after photos and before
// the outcome: the technician asks, and the client answers in their own app, which this screen hears of by reading the
// card again while it waits. A flag says what isn't right, and once it is put right the technician asks again. A client
// without their phone signs here; a client who will not sign is recorded with why. Each goes through the outbox, so all
// of it works with no signal.

import { Button } from "@maneman/ui/Button";
import { CheckRow } from "@maneman/ui/CheckRow";
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
import { useStep } from "./useStep.ts";
import styles from "./sign-off.module.css";

/** How often the card is read again while the client is still to answer. */
const LISTEN_MS = 10_000;

const CHECKS = ["hairline", "blend", "secure"] as const;
type Checks = Readonly<Record<(typeof CHECKS)[number], boolean>>;
const NONE_TICKED: Checks = { hairline: false, blend: false, secure: false };

/** Where the sign-off stands on this phone: the card's word, or what the phone still holds to send. */
type Standing = "unasked" | "asked" | "flagged" | "signed" | "declined";

/** What the client said on this phone, while it waits to be sent. */
function answeredOnPhone(event: Queued): Standing {
  const body = event.body as { readonly answer?: { readonly result?: string } } | null;
  return body?.answer?.result === "flagged" ? "flagged" : "signed";
}

function standingOf(job: Job, queued: readonly Queued[]): Standing {
  const mine = queued.filter((event) => event.job_id === job.id && event.state === "waiting");
  if (mine.some((event) => event.kind === "sign_off_declined")) return "declined";
  const onPhone = mine.findLast((event) => event.kind === "sign_off");
  if (onPhone !== undefined && job.sign_off?.state !== "signed") return answeredOnPhone(onPhone);
  const state = job.sign_off?.state;
  if (state === "signed" || state === "declined") return state;
  if (mine.some((event) => event.kind === "sign_off_request")) return "asked";
  return state ?? "unasked";
}

/** Sends what the phone queued now, where there is signal; the outbox tries again itself where there is none. */
async function queueAndSend(...args: Parameters<typeof queue>): Promise<void> {
  await queue(...args);
  void replay();
}

/** The client's three checks, each ticked or not. */
function CheckList({ checks, onChecks }: { checks: Checks; onChecks: (checks: Checks) => void }) {
  return (
    <ul className={styles.checks}>
      {CHECKS.map((check) => (
        <li key={check}>
          <CheckRow
            done={checks[check]}
            onToggle={() => {
              onChecks({ ...checks, [check]: !checks[check] });
            }}
          >
            {copy.phone.checks[check]}
          </CheckRow>
        </li>
      ))}
    </ul>
  );
}

/** The client signs here: a code asked for with signal, their three checks, and happy or what isn't right. */
function PhoneSheet({ job, onDone, onClose }: { job: Job; onDone: () => void; onClose: () => void }) {
  const titleId = useId();
  const [checks, setChecks] = useState<Checks>(NONE_TICKED);
  const [wrong, setWrong] = useState<string | null>(null);
  const [busy, once] = useOneAtATime();
  const all = CHECKS.every((check) => checks[check]);
  const send = (
    answer: { result: "signed"; checks: Checks } | { result: "flagged"; checks: Checks; flag_text: string },
  ) =>
    once(async () => {
      await queueAndSend("sign_off", job.id, { answer }, job.starts_at);
      onDone();
    });
  return (
    <Sheet labelledBy={titleId} rises={false} onClose={onClose}>
      <SheetClose onClose={onClose}>{copy.phone.close}</SheetClose>
      <SheetPanel className={styles.panel}>
        <h2 className={styles.title} id={titleId}>
          {copy.phone.title}
        </h2>
        <CheckList checks={checks} onChecks={setChecks} />
        <Button
          variant="primary"
          size="action"
          busy={busy}
          disabled={!all}
          onClick={() => void send({ result: "signed", checks })}
        >
          {copy.phone.happy}
        </Button>
        {wrong === null ? (
          <TextButton
            className={styles.notRight}
            onClick={() => {
              setWrong("");
            }}
          >
            {copy.phone.notRight}
          </TextButton>
        ) : (
          <>
            <WordsField label={copy.phone.what} text={wrong} max={500} onText={setWrong} />
            <Button
              variant="outline"
              size="action"
              busy={busy}
              disabled={wrong.trim() === ""}
              onClick={() => void send({ result: "flagged", checks, flag_text: wrong.trim() })}
            >
              {copy.phone.send}
            </Button>
          </>
        )}
      </SheetPanel>
    </Sheet>
  );
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

/** What the screen says of the sign-off, as it stands. */
function StandingLine({ job, standing }: { job: Job; standing: Standing }) {
  const signOff = job.sign_off;
  if (standing === "flagged") {
    return (
      <ProblemCard className={styles.flag} title={copy.flagged}>
        {signOff?.flag_text ?? ""}
      </ProblemCard>
    );
  }
  if (standing === "signed" && signOff !== null && signOff.signed_at !== null) {
    const where = signOff.signed_on === "technician_phone" ? [copy.onThisPhone] : [];
    return <p className={styles.done}>{[copy.signed, stamp(signOff.signed_at), ...where].join(" · ")}</p>;
  }
  if (standing === "declined") return <p className={styles.done}>{copy.declined(signOff?.declined_reason ?? "")}</p>;
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

/** The two ways to close a fit the client has not signed in their app: on this phone, or recorded as declined. */
function Ways({ job, onSigned }: { job: Job; onSigned: () => void }) {
  const [sheet, setSheet] = useState<"phone" | "decline" | null>(null);
  const shut = () => {
    setSheet(null);
  };
  return (
    <div className={styles.ways}>
      <Button
        variant="outline"
        size="control"
        onClick={() => {
          setSheet("phone");
        }}
      >
        {copy.onPhone}
      </Button>
      <TextButton
        onClick={() => {
          setSheet("decline");
        }}
      >
        {copy.declineOpen}
      </TextButton>
      {sheet === "phone" && (
        <PhoneSheet
          job={job}
          onDone={() => {
            shut();
            onSigned();
          }}
          onClose={shut}
        />
      )}
      {sheet === "decline" && <DeclineSheet job={job} onDone={shut} onClose={shut} />}
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
  const standing = standingOf(job, queued);
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
      <StandingLine job={job} standing={standing} />
      {!closes && standing !== "unasked" && <Ways job={job} onSigned={retry} />}
    </StepFrame>
  );
}

export function SignOff({ id }: { id: string }) {
  const { loaded, retry, queued, back } = useStep(id, "sign_off");
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <JobFailed failed={loaded} onRetry={retry} />;
  return <Signing job={loaded.value} queued={queued} retry={retry} back={back} />;
}
