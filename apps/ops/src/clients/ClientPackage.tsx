// The package a client is on, on their record (docs/decisions/0211-packages.md): the one they booked or ops chose,
// else their consultation's recommendation, changed where it reads (docs/decisions/0212-editing-in-place.md), as at a
// replacement. Their next service visit and replacement follow it from then.

import { EditableRow } from "@maneman/ui/EditableRow";
import { Select } from "@maneman/ui/Field";
import { Panel } from "@maneman/ui/Panel";
import { errorText } from "@maneman/web-kit/refusal";
import type { ClientRecord } from "../api.ts";
import { EDITING } from "../content/common.ts";
import { clients } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { clientsApi } from "./clients-api.ts";

const copy = clients.package;

/** The package by its name, or as the consultation recommended it until they are put on one. */
const shownOf = (current: { readonly name: string; readonly chosen: boolean }) =>
  current.chosen ? current.name : copy.recommended(current.name);

export function ClientPackage(props: {
  readonly clientId: string;
  readonly record: ClientRecord;
  readonly onChanged: () => void;
}) {
  const { record } = props;
  const mayChange = useAccess().mayCall("POST /api/clients/{id}/package");
  const current = record.package;
  const shown = current === null ? copy.none : shownOf(current);
  return (
    <Panel titleId="client-package" title={copy.title}>
      <EditableRow<string>
        label={copy.label}
        words={EDITING}
        mayChange={mayChange && record.packages.length > 0}
        value={shown}
        start={() => current?.code ?? record.packages[0]?.code ?? ""}
        save={async (code) => {
          const answer = await clientsApi.setPackage(props.clientId, code);
          if (!answer.ok) return errorText(copy.errors, answer);
          props.onChanged();
          return null;
        }}
      >
        {(control, chosen, choose) => (
          <Select
            {...control}
            width="choice"
            value={chosen}
            onChange={(event) => {
              choose(event.target.value);
            }}
          >
            {record.packages.map((each) => (
              <option key={each.code} value={each.code}>
                {each.name}
              </option>
            ))}
          </Select>
        )}
      </EditableRow>
    </Panel>
  );
}
