// Step 4, the hair system, for a replacement and a first fit only, scan-first as the prototype draws it
// (docs/decisions/0269-the-design-checks-api-side.md): what is expected, then its label read by the camera or typed, and
// the piece confirmed; on a replacement the piece that came off is the one the card has on the client's head
// (docs/decisions/0163-pieces-scanned-from-the-kit.md). A consultation and fit in one visit asks first for the client's
// choice (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md). "Can't fit today" closes the fit from here.

import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, unreachable, type EventBody, type Job } from "../api.ts";
import { steps as copy, visit } from "../content.ts";
import { JobFailed } from "../frame/JobFailed.tsx";
import { Loading } from "../frame/States.tsx";
import type { Queued } from "../store/outbox.ts";
import { CannotFit } from "./CannotFit.tsx";
import {
  choiceSent,
  DECLINED,
  inKit,
  fitsNothingToday,
  cameOff,
  labelWarning,
  given,
  kitChoices,
  kitMatch,
  labelTaken,
  leftAfter,
  profileToMatch,
  noticeFor,
  pieceBody,
  stillMissing,
  type Choice,
  type LabelChecked,
  type PieceForm,
} from "./piece-form.ts";
import { ChoiceList, KitPieces, NOT_LOOKED, type Looked } from "./PieceFields.tsx";
import { Confirmed, Expected, lineOf, Scanner } from "./PieceScan.tsx";
import { isLabel } from "./label.ts";
import { pieceSent, type PieceSent } from "./sent-before.ts";
import { StepFrame } from "./StepFrame.tsx";
import { useStep } from "./useStep.ts";
import styles from "./piece-scan.module.css";

/** How the step ends: the piece step sent, or the fit closed with "Can't fit today", with why where it was asked. */
type Finish = { readonly piece: EventBody<"piece"> } | { readonly cannotFit: string | null };

/** "Can't fit today": partly done, with no piece of the client's spec to fit, and why. */
const cannotFitClose = (why: string | null): EventBody<"outcome"> => ({
  outcome: "partial",
  reason: "no_piece",
  cannot_fit: true,
  ...(why === null ? {} : { not_fitted_reason: why }),
});

/** The label checked against the pieces we know: a client's fills in its base and lot where none is typed. */
function useLookup(
  job: Job,
  form: { readonly code: string; readonly base: string; readonly lot: string },
  fill: { readonly base: (base: string) => void; readonly lot: (lot: string) => void },
) {
  const [looked, setLooked] = useState<Looked>(NOT_LOOKED);
  const [looking, once] = useOneAtATime();
  const { code, base, lot } = form;
  const { base: fillBase, lot: fillLot } = fill;
  // The label now in the field, so an answer for one taken over since is never put on it.
  const current = useRef(code);
  useEffect(() => {
    current.current = code;
  }, [code]);
  const look = useCallback(
    () =>
      once(async () => {
        const answer = await api.piece(code, job.id);
        if (current.current !== code) return;
        if (answer.ok) {
          setLooked({ state: "found", found: answer.body });
          // Another client's piece is refused, and its base and lot are no part of this job.
          if (!answer.body.belongs_to_this_job) return;
          if (!given(base)) fillBase(answer.body.piece.base ?? "");
          if (!given(lot)) fillLot(answer.body.piece.supplier_lot ?? "");
          return;
        }
        setLooked(unreachable(answer) ? { state: "offline" } : { state: "unknown" });
      }),
    [once, code, job.id, base, lot, fillBase, fillLot],
  );
  // A label is checked as soon as it reads, typed whole or scanned (docs/prompts/tech-redesign.md, "Hair system"); one
  // taken while another was checked, once that check is done.
  useEffect(() => {
    if (isLabel(code) && looked.state === "none" && !looking) void look();
  }, [code, looked.state, looking, look]);
  return { looked, setLooked, looking, look } as const;
}

/** A one visit's decision as it is made: the product, or against the fit, and whether its fit is booked for later. */
function useDecision(sent: PieceSent | null) {
  const [choice, setChoice] = useState<Choice>(choiceSent(sent));
  const [later, setLater] = useState(sent?.later ?? false);
  return [
    { choice, later },
    { choice: setChoice, later: setLater },
  ] as const;
}

type Decision = ReturnType<typeof useDecision>;

/** A one visit's client's choice and when it is fitted, asked first. */
function Asked({ job, decided, decide }: { job: Job; decided: Decision[0]; decide: Decision[1] }) {
  return (
    <ChoiceList
      products={job.products}
      choice={decided.choice}
      later={decided.later}
      canFitToday={decided.choice !== null && inKit(job, decided.choice)}
      onChoose={(choice) => {
        decide.choice(choice);
        // A hair system the kit does not hold cannot be fitted today, so its fit is booked for later.
        if (choice !== DECLINED && !inKit(job, choice)) decide.later(true);
      }}
      onLater={decide.later}
    />
  );
}

/** What the label's check found, as the step asks it: a piece of another client's is never this one's. */
const checkedOf = (looked: Looked): LabelChecked =>
  looked.state === "found" && !looked.found.belongs_to_this_job ? "another_client" : looked.state;

/** The kit's hair systems whose pieces carry no labels, which a scan cannot find: picked, the label on the piece typed. */
const unlabelledOf = (choices: ReturnType<typeof kitChoices>) =>
  choices.filter(({ hairSystem }) => hairSystem.units.length === 0);

/** The step once the job is in hand: a refused piece starts as it was sent, so nothing is read twice. */
function Fitting({
  job,
  matchTo,
  refused,
  onFinish,
  onBack,
}: {
  job: Job;
  /** The profile the kit is matched to: the one the phone holds, else the card's. */
  matchTo: ReturnType<typeof profileToMatch>;
  refused: Queued | null;
  onFinish: (finish: Finish) => void;
  onBack: () => void;
}) {
  const sent = pieceSent(refused);
  const [code, setCode] = useState(sent?.code ?? "");
  const [base, setBase] = useState(sent?.base ?? "");
  const [lot, setLot] = useState(sent?.lot ?? "");
  const [stock, setStock] = useState<string | null>(sent?.stock ?? null);
  const { looked, setLooked, looking, look } = useLookup(job, { code, base, lot }, { base: setBase, lot: setLot });
  const [{ choice, later }, decide] = useDecision(sent);
  // The piece that comes off is the one the card has on the client's head from before today.
  const oldCode = cameOff(job)?.piece_code ?? "";

  const form: PieceForm = { code, base, lot, stock, oldCode, choice, later };
  const missing = stillMissing(form, job, checkedOf(looked));
  /** A label read or typed, with what follows it (piece-form's labelTaken). */
  const takeLabel = (label: string) => {
    const next = labelTaken(job, stock, label);
    setCode(label);
    setLooked(NOT_LOOKED);
    setStock(next.stock);
    setBase(next.base);
    setLot(next.lot);
  };
  const matched = { ...job, profile: matchTo };
  const fitsToday = !fitsNothingToday(form, job) && (!job.one_visit || choice !== null);

  return (
    <StepFrame
      title={copy.titles.piece}
      action={fitsNothingToday(form, job) ? visit.next(copy.checklistTitles.consultation) : undefined}
      ready={missing === null}
      unfinished={missing ?? undefined}
      notice={refused === null ? null : noticeFor(refused.fields)}
      onBack={onBack}
      onAction={() => {
        onFinish({ piece: pieceBody(form, job) });
      }}
    >
      {job.one_visit && <Asked job={job} decided={{ choice, later }} decide={decide} />}
      {fitsToday && (
        <div className={styles.scan}>
          <Expected job={job} fit={matchTo?.fit ?? null} choice={choice} />
          {/* Confirmed once it is known: with no signal to check it, it stays as typed, saying so. */}
          {missing === null && isLabel(code) && looked.state !== "offline" ? (
            <Confirmed
              code={code}
              line={lineOf(job, { choice, stock, fit: matchTo?.fit ?? null })}
              matches={kitMatch(matched, choice, stock)}
              left={leftAfter(job, stock)}
              onRescan={() => {
                takeLabel("");
              }}
            />
          ) : (
            <Scanner
              code={code}
              looked={looked}
              looking={looking}
              warning={labelWarning(matched, form)}
              cannotFit={
                <CannotFit
                  reasons={job.not_fitted_reasons}
                  onClose={(why) => {
                    onFinish({ cannotFit: why });
                  }}
                />
              }
              onCode={takeLabel}
              onLook={() => void look()}
            />
          )}
        </div>
      )}
      {fitsToday && <KitPieces choices={unlabelledOf(kitChoices(matched, choice))} stock={stock} onStock={setStock} />}
    </StepFrame>
  );
}

export function Piece({ id }: { id: string }) {
  const { loaded, retry, refused, queued, finish, closeWith, back } = useStep(id, "piece");

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") {
    return <JobFailed failed={loaded} onRetry={retry} />;
  }
  const finishing = (done: Finish) =>
    void ("piece" in done ? finish(done.piece) : closeWith(cannotFitClose(done.cannotFit)));
  const job = loaded.value;
  return (
    <Fitting job={job} matchTo={profileToMatch(job, queued)} refused={refused} onFinish={finishing} onBack={back} />
  );
}
