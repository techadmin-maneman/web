// Why a client is not going ahead after their consultation (docs/decisions/0149-lost-reasons.md): the reason kept with
// a closed consultation, which Care may set, change or clear as the client tells them. The visit's row says it, and
// the choice opens beside the page, so no box stands in the table.

import { Field, Select } from "@maneman/ui/Field";
import { TextButton } from "@maneman/ui/TextLink";
import { boxError, type Failure } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { type ClientRecord } from "../api.ts";
import { clients } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { FormDrawer } from "../components/FormDrawer.tsx";
import { Refused } from "../components/Refusal.tsx";
import styles from "./clients.module.css";
import { clientsApi } from "./clients-api.ts";

type ClientVisit = ClientRecord["visits"]["past"][number];
type Reason = NonNullable<ClientVisit["lost_reason"]>;

const copy = clients.visits.lostReason;

/** The list to pick from, with the visit's own reason kept on it where ops have since taken that off. */
const choicesFor = (reasons: readonly Reason[], kept: Reason | null): readonly Reason[] =>
  kept === null || reasons.some((reason) => reason.code === kept.code) ? reasons : [...reasons, kept];

export function LostReason({
  visit,
  reasons,
  onChanged,
}: {
  visit: ClientVisit;
  /** The job sheet's list; null where the reason is only shown, as on an erased client's page. */
  reasons: readonly Reason[] | null;
  onChanged: () => void;
}) {
  const access = useAccess();
  const [failure, setFailure] = useState<Failure | null>(null);
  const [choosing, setChoosing] = useState(false);
  const kept = visit.lost_reason;
  const mayChange =
    reasons !== null &&
    visit.type === "consultation" &&
    visit.outcome !== null &&
    access.mayCall("POST /api/visits/{id}/lost-reason");
  if (!mayChange) return kept === null ? null : <span className={styles.closedLine}>{copy.kept(kept.label)}</span>;

  const set = async (code: string) => {
    setFailure(null);
    const answer = await clientsApi.setLostReason(visit.id, { lost_reason: code === "" ? null : code });
    if (!answer.ok) {
      setFailure({ code: answer.code, fields: answer.fields });
      return;
    }
    setChoosing(false);
    onChanged();
  };
  const heardYes = visit.going_ahead === true ? copy.goingAhead : null;
  const line = kept === null ? heardYes : copy.kept(kept.label);
  return (
    <>
      {line !== null && <span className={styles.closedLine}>{line}</span>}
      <TextButton
        compact
        onClick={() => {
          setChoosing(true);
        }}
      >
        {kept === null ? copy.label : copy.change}
      </TextButton>
      {choosing && (
        <FormDrawer
          title={copy.label}
          onClose={() => {
            setChoosing(false);
          }}
        >
          <Field label={copy.label} labelHidden error={boxError(copy.errors, failure, "lost_reason")}>
            {(control) => (
              <Select
                {...control}
                width="choice"
                value={kept?.code ?? ""}
                onChange={(event) => void set(event.target.value)}
              >
                <option value="">{visit.going_ahead === true ? copy.goingAhead : copy.notSaid}</option>
                {choicesFor(reasons, kept).map((reason) => (
                  <option key={reason.code} value={reason.code}>
                    {reason.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Refused failed={failure} errors={copy.errors} boxes={["lost_reason"]} />
        </FormDrawer>
      )}
    </>
  );
}
