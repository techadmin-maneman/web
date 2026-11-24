// How a client found us, on their page (docs/decisions/0288-attribution-and-conversions.md): their channel by the
// rule and their last touch's, their first and last touch, and how many there were; what they told ops when asked at
// the consultation, kept apart and changed where it reads; and whether their details still go to Google and Meta,
// which they may ask to stop.

import { ACTION_ICONS } from "@maneman/brand/action-icons";
import { DeleteAction } from "@maneman/ui/DeleteAction";
import { Panel } from "@maneman/ui/Panel";
import { ChoiceRow, ReadRow, TextRow } from "@maneman/ui/RecordRows";
import { SettingPairs } from "@maneman/ui/SettingsLayout";
import { PanelFailed, PanelLoading } from "@maneman/ui/States";
import { useLoad } from "@maneman/ui/useLoad";
import { apiNow } from "@maneman/web-kit/clock";
import { indiaDate, listDate, yearInIndia } from "@maneman/web-kit/dates";
import { errorText } from "@maneman/web-kit/refusal";
import { channelNamed } from "@rules/policy/channels.ts";
import { HEARD_FROM } from "@rules/policy/heard-from.ts";
import { useCallback } from "react";
import form from "@maneman/ui/forms.module.css";
import { foundUs as copy } from "../content/found-us.ts";
import { useAccess } from "../lib/access.ts";
import { clientsApi, type ClientAttribution } from "./clients-api.ts";

type Touch = NonNullable<ClientAttribution["first_touch"]>;

/** An instant's day in India, as the console lists days. */
const dayOf = (instant: string) => listDate(indiaDate(instant), yearInIndia(apiNow()));

/** A touch in a line: its channel, its campaign or link, and its day. */
const touchWords = (touch: Touch | null) =>
  touch === null
    ? copy.none
    : copy.touch(
        channelNamed(touch.channel),
        touch.link_name === null ? touch.utm_campaign : copy.link(touch.link_name),
        dayOf(touch.at),
      );

const HEARD = HEARD_FROM.map((each) => [each.code, each.label] as const);

/** The answers to pick from: "Not asked yet" only while none is kept, since an answer is changed, never taken back. */
const heardChoices = (kept: string | null) => (kept === null ? [["", copy.notAsked] as const, ...HEARD] : HEARD);

function Rows(props: { clientId: string; name: string; found: ClientAttribution; onChanged: () => void }) {
  const { found, clientId } = props;
  const access = useAccess();
  const mayTell = access.mayCall("POST /api/clients/{id}/heard-from");
  const save = async (heardFrom: string, other: string | null) => {
    const code = HEARD_FROM.find((each) => each.code === heardFrom)?.code;
    if (code === undefined) return copy.errors.invalid_request;
    const answer = await clientsApi.setHeardFrom(clientId, {
      heard_from: code,
      ...(other === null ? {} : { heard_from_other: other }),
    });
    if (!answer.ok) return errorText(copy.errors, answer);
    props.onChanged();
    return null;
  };
  return (
    <>
      <SettingPairs>
        <ReadRow
          label={copy.rows.channel}
          value={found.attributed_channel === null ? copy.none : channelNamed(found.attributed_channel)}
        />
        <ReadRow
          label={copy.rows.lastTouch}
          value={found.last_touch_channel === null ? copy.none : touchWords(found.last_touch)}
        />
        <ReadRow label={copy.rows.firstTouch} value={touchWords(found.first_touch)} />
        <ReadRow label={copy.rows.touches} value={String(found.touches)} />
        <ChoiceRow
          label={copy.rows.heardFrom}
          mayChange={mayTell}
          value={found.heard_from ?? ""}
          choices={heardChoices(found.heard_from)}
          save={(chosen) => save(chosen, chosen === "other" ? found.heard_from_other : null)}
        />
        {found.heard_from === "other" && (
          <TextRow
            label={copy.other}
            maxLength={80}
            mayChange={mayTell}
            value={found.heard_from_other ?? ""}
            save={(typed) =>
              typed.trim() === "" ? Promise.resolve(copy.errors.heard_from_other) : save("other", typed.trim())
            }
          />
        )}
        <ReadRow
          label={copy.rows.sharing}
          value={found.sharing_stopped_at === null ? copy.sharing : copy.stopped(dayOf(found.sharing_stopped_at))}
        />
      </SettingPairs>
      {found.sharing_stopped_at === null && access.mayCall("POST /api/clients/{id}/stop-sharing") && (
        <div className={form.recordFoot}>
          <DeleteAction
            icon={ACTION_ICONS.ban}
            name={props.name}
            words={copy.stopping}
            send={() => clientsApi.stopSharing(clientId)}
            refusal={(code) => errorText(copy.errors, { code })}
            onDeleted={props.onChanged}
          />
        </div>
      )}
    </>
  );
}

export function FoundUs(props: { clientId: string; name: string }) {
  const read = useCallback(() => clientsApi.attribution(props.clientId), [props.clientId]);
  const [loaded, retry] = useLoad(read);
  return (
    <Panel titleId="found-us" title={copy.title}>
      {loaded.state === "loading" && <PanelLoading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {loaded.state === "loaded" && (
        <Rows clientId={props.clientId} name={props.name} found={loaded.value} onChanged={retry} />
      )}
    </Panel>
  );
}
