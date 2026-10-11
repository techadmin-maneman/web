// A move to another day ops asked the client to confirm (docs/decisions/0115-a-move-to-another-day-waits-for-the-client.md):
// the visit stays where it is until they accept it here. Picking another time instead is the card's own Reschedule,
// which reads so while the proposal is open.

import { Button } from "@maneman/ui/Button";
import { shortDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { api, type VisitSummary } from "../api.ts";
import { home, WINDOW_HOURS } from "../content.ts";
import { useSession } from "../session.ts";
import styles from "./home.module.css";
import { firstNameOf } from "../../../../src/lib/names.ts";

type Proposal = NonNullable<VisitSummary["proposed_move"]>;

/** gone: the time was taken since, or the proposal ran out, so the client picks another. */
type Answered = "open" | "accepting" | "gone" | "failed";

export function ProposedMove({ visitId, proposal }: { visitId: string; proposal: Proposal }) {
  const { refresh, offline } = useSession();
  const [answered, setAnswered] = useState<Answered>("open");
  const copy = home.proposal;
  const when = `${shortDate(proposal.date)}, ${WINDOW_HOURS[proposal.window]}`;
  const technician = proposal.technician === null ? null : firstNameOf(proposal.technician.name);

  async function accept() {
    setAnswered("accepting");
    const answer = await api.acceptProposedMove(visitId);
    if (answer.ok) {
      setAnswered("open");
      refresh();
      return;
    }
    setAnswered(answer.code === "move_gone" || answer.code === "not_found" ? "gone" : "failed");
  }

  return (
    <div className={styles.proposal}>
      <p>{copy.ask(when, technician)}</p>
      <div aria-live="polite">
        {answered === "gone" && <p className={styles.proposalNote}>{copy.gone}</p>}
        {answered === "failed" && <p className={styles.proposalNote}>{copy.failed}</p>}
      </div>
      {answered !== "gone" && (
        <Button
          variant="light"
          size="control"
          className={styles.accept}
          busy={answered === "accepting"}
          disabled={offline || answered === "accepting"}
          onClick={() => void accept()}
        >
          {copy.accept(shortDate(proposal.date))}
        </Button>
      )}
    </div>
  );
}
