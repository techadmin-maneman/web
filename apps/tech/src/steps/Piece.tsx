// Step 4: the piece. A replacement's and a first fit's step only —
// the API leaves it out of the other types' `steps`, so this screen is never
// reached for them.
//
// A consultation and fit in one visit comes here straight after the before
// photographs, and asks first for the client's choice, which no board draws: the
// product they chose, by name and never by price, or that they decided against
// the fit, when nothing is fitted and no label is asked for. The checklist that
// follows lists the fit's items only for a client being fitted
// (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md). Any other visit
// says first what the client paid for, and warns when the hair profile names
// another product.
//
// The design draws "Scan the piece", but labels carry neither a barcode nor a QR
// code, so the label is typed, or picked from the client's pieces the card
// carries, and checked against the API's format before Next will take it. A
// check against the mirror needs signal; a label the mirror does not know, or
// one checked with none, still goes on the job as the technician entered it.
//
// The pieces tab keeps each piece's base and supplier lot, and on a
// replacement the piece that came off and why it failed, so the step asks for
// them: a lookup fills the base and lot in when it knows them.

import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useState } from "react";
import { api, unreachable, type EventBody, type Job } from "../api.ts";
import { job as jobCopy, steps as copy } from "../content.ts";
import { Failed, Loading } from "../states/States.tsx";
import type { Queued } from "../store/outbox.ts";
import {
  choiceSent,
  declinedTheFit,
  given,
  noticeFor,
  onTheHead,
  pieceBody,
  stillMissing,
  toFit,
  type Choice,
  type ClientPiece,
  type PieceForm,
} from "./piece-form.ts";
import { BaseAndLot, ChoiceList, LabelField, NOT_LOOKED, OldPiece, PaidFor, type Looked } from "./PieceFields.tsx";
import { pieceSent } from "./sent-before.ts";
import { StepFrame } from "./StepFrame.tsx";
import { useStep } from "./useStep.ts";

/** The step once the job is in hand: a refused piece starts as it was sent, so nothing is typed twice. */
function Fitting({
  job,
  refused,
  onFinish,
  onBack,
}: {
  job: Job;
  refused: Queued | null;
  onFinish: (body: EventBody<"piece">) => void;
  onBack: () => void;
}) {
  const sent = pieceSent(refused);
  const [code, setCode] = useState(sent?.code ?? "");
  const [base, setBase] = useState(sent?.base ?? "");
  const [lot, setLot] = useState(sent?.lot ?? "");
  const [looked, setLooked] = useState<Looked>(NOT_LOOKED);
  const [looking, once] = useOneAtATime();
  const [oldCode, setOldCode] = useState(sent?.oldCode ?? "");
  const [oldReason, setOldReason] = useState(sent?.oldReason ?? "");
  const [picking, setPicking] = useState<"new" | "old" | null>(null);
  const [choice, setChoice] = useState<Choice>(choiceSent(sent));

  const pieces = job.pieces ?? [];
  const form: PieceForm = { code, base, lot, oldCode, oldReason, choice };
  const notThisClients = looked.state === "found" && !looked.found.belongs_to_this_job;
  const missing = stillMissing(form, job, notThisClients);

  const look = () =>
    once(async () => {
      const answer = await api.piece(code, job.id);
      if (answer.ok) {
        setLooked({ state: "found", found: answer.body });
        // Another client's piece is refused, and its base and lot are no part of this job.
        if (!answer.body.belongs_to_this_job) return;
        if (!given(base)) setBase(answer.body.piece.base ?? "");
        if (!given(lot)) setLot(answer.body.piece.supplier_lot ?? "");
        return;
      }
      setLooked(unreachable(answer) ? { state: "offline" } : { state: "unknown" });
    });

  const pickNew = (piece: ClientPiece) => {
    setCode(piece.piece_code);
    setBase(piece.base ?? "");
    setLot(piece.supplier_lot ?? "");
    setLooked({ state: "found", found: { piece, belongs_to_this_job: true } });
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
      {job.one_visit ? (
        <ChoiceList products={job.products} choice={choice} onChoose={setChoice} />
      ) : (
        <PaidFor job={job} />
      )}
      {!declinedTheFit(form, job) && (
        <>
          <LabelField
            code={code}
            looked={looked}
            looking={looking}
            pieces={pieces.filter(toFit)}
            picking={picking === "new"}
            onCode={(typed) => {
              setCode(typed);
              setLooked(NOT_LOOKED);
            }}
            onLook={() => void look()}
            onTogglePicking={toggle("new")}
            onPick={pickNew}
          />
          <BaseAndLot base={base} lot={lot} onBase={setBase} onLot={setLot} />
          {job.type === "replacement" && (
            <OldPiece
              code={oldCode}
              reason={oldReason}
              pieces={pieces.filter(onTheHead)}
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
    </StepFrame>
  );
}

export function Piece({ id }: { id: string }) {
  const { loaded, retry, refused, finish, back } = useStep(id, "piece");

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") {
    return <Failed message={jobCopy.failed} retry={jobCopy.retry} onRetry={retry} requestId={loaded.requestId} />;
  }
  return <Fitting job={loaded.value} refused={refused} onFinish={(body) => void finish(body)} onBack={back} />;
}
