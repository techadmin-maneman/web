// A client's lead, on their page (docs/decisions/0320-lead-stages.md): each stage, read from what happened, with the
// day it was first reached; and whether the lead was lost, why (one of the job sheet's lost reasons, as the
// consultation's reason is) and the client's objection, changed where it reads.

import { NoValue } from "@maneman/ui/NoValue";
import { Panel } from "@maneman/ui/Panel";
import { ChoiceRow, ReadRow, TextRow } from "@maneman/ui/RecordRows";
import { SettingPairs } from "@maneman/ui/SettingsLayout";
import { PanelFailed, PanelLoading } from "@maneman/ui/States";
import { useLoad } from "@maneman/ui/useLoad";
import { apiNow } from "@maneman/web-kit/clock";
import { indiaDate, listDate, yearInIndia } from "@maneman/web-kit/dates";
import { errorText } from "@maneman/web-kit/refusal";
import { LOST_OBJECTION_MAX } from "@rules/policy/lost-leads.ts";
import { useCallback } from "react";
import { leadStages as copy } from "../content/lead-stages.ts";
import { useAccess } from "../lib/access.ts";
import { clientsApi, type ClientAttribution } from "./clients-api.ts";

/** One of the job sheet's lost reasons, as the client's record lists them. */
interface Reason {
  readonly code: string;
  readonly label: string;
}

/** The day a stage was first reached, as the console lists days, or that it is not reached yet. */
const dayOf = (instant: string | null) =>
  instant === null ? copy.notYet : listDate(indiaDate(instant), yearInIndia(apiNow()));

/** Not lost, then the job sheet's reasons, and the one kept should ops have taken it off the list since. */
function choicesFor(reasons: readonly Reason[], kept: string | null): readonly (readonly [string, string])[] {
  const listed = reasons.map((reason) => [reason.code, reason.label] as const);
  const gone = kept !== null && !reasons.some((reason) => reason.code === kept) ? [[kept, kept] as const] : [];
  return [["", copy.notLost] as const, ...listed, ...gone];
}

function Rows(props: { clientId: string; reasons: readonly Reason[]; lead: ClientAttribution; onChanged: () => void }) {
  const { lead, clientId } = props;
  const mayChange = useAccess().mayCall("POST /api/clients/{id}/lost");
  const save = async (reason: string, objection: string | null) => {
    const answer = await clientsApi.setLost(clientId, {
      lost_reason: reason === "" ? null : reason,
      ...(reason === "" || objection === null ? {} : { lost_objection: objection }),
    });
    if (!answer.ok) return errorText(copy.errors, answer);
    props.onChanged();
    return null;
  };
  return (
    <SettingPairs>
      <ReadRow label={copy.rows.became} value={dayOf(lead.became_lead_at)} />
      <ReadRow label={copy.rows.firstReply} value={dayOf(lead.first_reply_at)} />
      <ReadRow label={copy.rows.qualified} value={dayOf(lead.qualified_at)} />
      <ReadRow label={copy.rows.attended} value={dayOf(lead.attended_at)} />
      <ReadRow label={copy.rows.fitted} value={dayOf(lead.fitted_at)} />
      <ChoiceRow
        label={copy.rows.lost}
        mayChange={mayChange}
        value={lead.lost_reason ?? ""}
        choices={choicesFor(props.reasons, lead.lost_reason)}
        save={(chosen) => save(chosen, lead.lost_objection)}
      />
      {lead.lost_reason !== null && (
        <>
          <ReadRow label={copy.rows.lostOn} value={dayOf(lead.lost_at)} />
          <TextRow
            label={copy.rows.objection}
            maxLength={LOST_OBJECTION_MAX}
            mayChange={mayChange}
            value={lead.lost_objection ?? ""}
            shown={lead.lost_objection ?? <NoValue />}
            save={(typed) => save(lead.lost_reason ?? "", typed.trim() === "" ? null : typed.trim())}
          />
        </>
      )}
    </SettingPairs>
  );
}

export function LeadStages(props: { clientId: string; reasons: readonly Reason[] }) {
  const read = useCallback(() => clientsApi.attribution(props.clientId), [props.clientId]);
  const [loaded, retry] = useLoad(read);
  return (
    <Panel titleId="lead-stages" title={copy.title}>
      {loaded.state === "loading" && <PanelLoading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {loaded.state === "loaded" && (
        <Rows clientId={props.clientId} reasons={props.reasons} lead={loaded.value} onChanged={retry} />
      )}
    </Panel>
  );
}
