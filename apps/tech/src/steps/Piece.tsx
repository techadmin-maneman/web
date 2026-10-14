// Step 4, the piece, for a replacement and a first fit only: its label scanned, typed or picked from the kit, and on a
// replacement the piece that came off (docs/decisions/0163-pieces-scanned-from-the-kit.md). A consultation and fit in
// one visit asks first for the client's choice (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md).

import { Button } from "@maneman/ui/Button";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useState } from "react";
import { api, unreachable, type EventBody, type Job } from "../api.ts";
import { ConfirmSheet } from "@maneman/ui/ConfirmSheet";
import { job as jobCopy, steps as copy } from "../content.ts";
import { Failed, Loading } from "../states/States.tsx";
import type { Queued } from "../store/outbox.ts";
import {
  choiceSent,
  declinedTheFit,
  afterLabel,
  expiredInKit,
  given,
  kitChoices,
  noticeFor,
  onTheHead,
  pieceBody,
  stillMissing,
  toFit,
  type Choice,
  type ClientPiece,
  type PieceForm,
} from "./piece-form.ts";
import {
  BaseAndLot,
  ChoiceList,
  KitPieces,
  LabelField,
  NOT_LOOKED,
  OldPiece,
  PaidFor,
  type Looked,
} from "./PieceFields.tsx";
import { pieceSent } from "./sent-before.ts";
import { StepFrame } from "./StepFrame.tsx";
import { useStep } from "./useStep.ts";
import styles from "./steps.module.css";

/** The outcome "Can't fit today" closes a fit with: partly done, no piece of the client's spec to fit. */
const CANNOT_FIT: EventBody<"outcome"> = { outcome: "partial", reason: "no_piece", cannot_fit: true };
const CANNOT_FIT_TODAY = "cannot_fit";

/** "Can't fit today": asked first, then the job closed as partly done from here (useStep's closeWith). */
function CannotFit({ onClose }: { onClose: (why: typeof CANNOT_FIT_TODAY) => void }) {
  const [asking, setAsking] = useState(false);
  const words = copy.piece.cannotFit;
  return (
    <>
      <Button
        variant="outlineOnInk"
        size="small"
        className={styles.wayOut}
        onClick={() => {
          setAsking(true);
        }}
      >
        {words.action}
      </Button>
      {asking && (
        <ConfirmSheet
          title={words.title}
          body={words.body}
          yes={words.yes}
          no={words.no}
          onYes={() => {
            onClose(CANNOT_FIT_TODAY);
          }}
          onNo={() => {
            setAsking(false);
          }}
        />
      )}
    </>
  );
}

/** The label checked against the pieces we know: a client's fills in its base and lot where none is typed. */
function useLookup(
  job: Job,
  form: { readonly code: string; readonly base: string; readonly lot: string },
  fill: { readonly base: (base: string) => void; readonly lot: (lot: string) => void },
) {
  const [looked, setLooked] = useState<Looked>(NOT_LOOKED);
  const [looking, once] = useOneAtATime();
  const look = () =>
    once(async () => {
      const answer = await api.piece(form.code, job.id);
      if (answer.ok) {
        setLooked({ state: "found", found: answer.body });
        // Another client's piece is refused, and its base and lot are no part of this job.
        if (!answer.body.belongs_to_this_job) return;
        if (!given(form.base)) fill.base(answer.body.piece.base ?? "");
        if (!given(form.lot)) fill.lot(answer.body.piece.supplier_lot ?? "");
        return;
      }
      setLooked(unreachable(answer) ? { state: "offline" } : { state: "unknown" });
    });
  return { looked, setLooked, looking, look } as const;
}

/** What the step asks first: a one visit's client's choice, or what any other fit was paid for. */
function Asked({ job, choice, onChoose }: { job: Job; choice: Choice; onChoose: (choice: Choice) => void }) {
  return job.one_visit ? (
    <ChoiceList products={job.products} choice={choice} onChoose={onChoose} />
  ) : (
    <PaidFor job={job} />
  );
}

/** The step once the job is in hand: a refused piece starts as it was sent, so nothing is typed twice. */
function Fitting({
  job,
  refused,
  onFinish,
  onBack,
}: {
  job: Job;
  refused: Queued | null;
  onFinish: (body: EventBody<"piece"> | typeof CANNOT_FIT_TODAY) => void;
  onBack: () => void;
}) {
  const sent = pieceSent(refused);
  const [code, setCode] = useState(sent?.code ?? "");
  const [base, setBase] = useState(sent?.base ?? "");
  const [lot, setLot] = useState(sent?.lot ?? "");
  const [stock, setStock] = useState<string | null>(sent?.stock ?? null);
  const { looked, setLooked, looking, look } = useLookup(job, { code, base, lot }, { base: setBase, lot: setLot });
  const [oldCode, setOldCode] = useState(sent?.oldCode ?? "");
  const [oldReason, setOldReason] = useState(sent?.oldReason ?? "");
  const [picking, setPicking] = useState<"new" | "old" | null>(null);
  const [choice, setChoice] = useState<Choice>(choiceSent(sent));

  const form: PieceForm = { code, base, lot, stock, oldCode, oldReason, choice };
  const expired = expiredInKit(job, code);
  const missing = expired
    ? copy.piece.expiredAction
    : stillMissing(form, job, looked.state === "found" && !looked.found.belongs_to_this_job);
  /** A label typed or scanned: one of the kit's pieces picks its hair system and fills in its lot. */
  const takeLabel = (label: string) => {
    const next = afterLabel(job, { code, lot }, label);
    setCode(label);
    setLooked(NOT_LOOKED);
    if (next.stock !== null) setStock(next.stock);
    setLot(next.lot);
  };

  const pickNew = (piece: ClientPiece) => {
    setCode(piece.piece_code);
    setBase(piece.base ?? "");
    setLot(piece.supplier_lot ?? "");
    setLooked({ state: "found", found: { piece, belongs_to_this_job: true, in_kit: false } });
    setPicking(null);
  };
  const toggle = (list: "new" | "old") => () => {
    setPicking(picking === list ? null : list);
  };

  return (
    <StepFrame
      title={copy.titles.piece}
      action={copy.next}
      ready={missing === null}
      unfinished={missing ?? undefined}
      notice={refused === null ? null : noticeFor(refused.fields)}
      onBack={onBack}
      onAction={() => {
        onFinish(pieceBody(form, job));
      }}
    >
      <Asked job={job} choice={choice} onChoose={setChoice} />
      {!declinedTheFit(form, job) && (
        <>
          <KitPieces choices={kitChoices(job, choice)} stock={stock} onStock={setStock} />
          <LabelField
            code={code}
            looked={looked}
            looking={looking}
            expired={expired}
            pieces={(job.pieces ?? []).filter(toFit)}
            picking={picking === "new"}
            onCode={takeLabel}
            onLook={() => void look()}
            onTogglePicking={toggle("new")}
            onPick={pickNew}
          />
          <BaseAndLot base={base} lot={lot} onBase={setBase} onLot={setLot} />
          {job.type === "replacement" && (
            <OldPiece
              code={oldCode}
              reason={oldReason}
              pieces={(job.pieces ?? []).filter(onTheHead)}
              picking={picking === "old"}
              onCode={setOldCode}
              onReason={setOldReason}
              onTogglePicking={toggle("old")}
              onPick={(piece) => {
                setOldCode(piece.piece_code);
                setPicking(null);
              }}
            />
          )}
        </>
      )}
      {!job.one_visit && <CannotFit onClose={onFinish} />}
    </StepFrame>
  );
}

export function Piece({ id }: { id: string }) {
  const { loaded, retry, refused, finish, closeWith, back } = useStep(id, "piece");

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") {
    return <Failed message={jobCopy.failed} retry={jobCopy.retry} onRetry={retry} requestId={loaded.requestId} />;
  }
  const finishing = (body: EventBody<"piece"> | typeof CANNOT_FIT_TODAY) =>
    void (body === CANNOT_FIT_TODAY ? closeWith(CANNOT_FIT) : finish(body));
  return <Fitting job={loaded.value} refused={refused} onFinish={finishing} onBack={back} />;
}
