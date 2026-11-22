// Step 4, the hair system, for a replacement and a first fit only, scan-first as the prototype draws it
// (docs/decisions/0270-the-design-checks-api-side.md): what is expected, then its label read by the camera or typed, and
// the piece confirmed; on a replacement the piece that came off is the one the card has on the client's head
// (docs/decisions/0163-pieces-scanned-from-the-kit.md). A consultation and fit in one visit asks first for the client's
// choice (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md). "Can't fit today" closes the fit from here.

import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
import { Confirmed, Expected, lineOf, NoLabel, Scanner } from "./PieceScan.tsx";
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

/**
 * The label as read so far: confirmed once it is known, with no signal to check it as typed, saying so; else the
 * scanner, which also says the piece has no label where the kit holds a hair system to pick in its place.
 */
function LabelRead(props: {
  readonly job: Job;
  readonly matched: Parameters<typeof kitMatch>[0] & Parameters<typeof labelWarning>[0];
  readonly form: PieceForm;
  readonly read: { readonly missing: string | null; readonly looked: Looked; readonly looking: boolean };
  readonly cannotFit: ReactNode;
  readonly onCode: (code: string) => void;
  readonly onLook: () => void;
  readonly onNoLabel: () => void;
}) {
  const { job, matched, form, read } = props;
  if (read.missing === null && isLabel(form.code) && read.looked.state !== "offline") {
    return (
      <Confirmed
        code={form.code}
        line={lineOf(job, { choice: form.choice, stock: form.stock, fit: matched.profile?.fit ?? null })}
        matches={kitMatch(matched, form.choice, form.stock)}
        left={leftAfter(job, form.stock)}
        onRescan={() => {
          props.onCode("");
        }}
      />
    );
  }
  return (
    <Scanner
      code={form.code}
      looked={read.looked}
      looking={read.looking}
      warning={labelWarning(matched, form)}
      cannotFit={props.cannotFit}
      onCode={props.onCode}
      onLook={props.onLook}
      onNoLabel={kitChoices(matched, form.choice).length === 0 ? undefined : props.onNoLabel}
    />
  );
}

/**
 * The step's form as the technician fills it in, a refused piece's as it was sent; and a label read or typed taken with
 * what follows it (piece-form's labelTaken).
 */
function usePieceForm(job: Job, sent: PieceSent | null) {
  const [code, setCode] = useState(sent?.code ?? "");
  const [noLabel, setNoLabel] = useState(sent?.noLabel ?? false);
  const [base, setBase] = useState(sent?.base ?? "");
  const [lot, setLot] = useState(sent?.lot ?? "");
  const [stock, setStock] = useState<string | null>(sent?.stock ?? null);
  const [failure, setFailure] = useState(sent?.failure ?? null);
  const lookup = useLookup(job, { code, base, lot }, { base: setBase, lot: setLot });
  const [{ choice, later }, decide] = useDecision(sent);
  // The piece that comes off is the one the card has on the client's head from before today.
  const oldCode = cameOff(job)?.piece_code ?? "";
  const form: PieceForm = { code, noLabel, base, lot, stock, oldCode, failure, choice, later };
  const takeLabel = (label: string) => {
    const next = labelTaken(job, stock, label, sent);
    setCode(label);
    lookup.setLooked(NOT_LOOKED);
    setStock(next.stock);
    setBase(next.base);
    setLot(next.lot);
  };
  return { form, lookup, decide, set: { noLabel: setNoLabel, stock: setStock, failure: setFailure }, takeLabel };
}

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
  const { form, lookup, decide, set, takeLabel } = usePieceForm(job, pieceSent(refused));
  const { noLabel, stock, choice, later } = form;
  const { looked, looking, look } = lookup;
  const missing = stillMissing(form, job, checkedOf(looked));
  const { noLabel: setNoLabel, stock: setStock, failure: setFailure } = set;
  const matched = { ...job, profile: matchTo };
  const cannotFit = (
    <CannotFit
      reasons={job.not_fitted_reasons}
      onClose={(why) => {
        onFinish({ cannotFit: why });
      }}
    />
  );
  const fitsToday = !fitsNothingToday(form, job) && (!job.one_visit || choice !== null);

  return (
    <StepFrame
      title={copy.titles.piece}
      action={fitsNothingToday(form, job) ? visit.next(copy.checklistTitles.consultation) : undefined}
      ready={missing === null}
      unfinished={missing ?? undefined}
      notice={refused === null ? null : noticeFor(refused.fields, refused.body)}
      onBack={onBack}
      onAction={() => {
        onFinish({ piece: pieceBody(form, job) });
      }}
    >
      {job.one_visit && <Asked job={job} decided={{ choice, later }} decide={decide} />}
      {fitsToday && (
        <div className={styles.scan}>
          <Expected job={job} form={form} fit={matchTo?.fit ?? null} onFailure={setFailure} />
          {/* With no label to read, the hair system is picked from the kit below. */}
          {noLabel ? (
            <NoLabel
              cannotFit={cannotFit}
              onScan={() => {
                setNoLabel(false);
              }}
            />
          ) : (
            <LabelRead
              job={job}
              matched={matched}
              form={form}
              read={{ missing, looked, looking }}
              cannotFit={cannotFit}
              onCode={takeLabel}
              onLook={() => void look()}
              onNoLabel={() => {
                takeLabel("");
                setNoLabel(true);
              }}
            />
          )}
        </div>
      )}
      {/* Every hair system of the kit where the piece has no label; else only those whose pieces carry none. */}
      {fitsToday && (
        <KitPieces
          choices={noLabel ? kitChoices(matched, choice) : unlabelledOf(kitChoices(matched, choice))}
          stock={stock}
          pick={noLabel}
          onStock={setStock}
        />
      )}
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
