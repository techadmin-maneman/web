// "Was the hair system at fault?", as Care close a guarantee claim or a chat about the hair system the client wears
// (docs/decisions/0273-why-a-hair-system-failed.md): No, or why it failed, from the reasons ops keep, which the
// client's Hair systems tab is read with. No is where it starts, so nothing is marked failed unless Care say so.

import { Field, Select } from "@maneman/ui/Field";
import { useLoad } from "@maneman/ui/useLoad";
import { useCallback } from "react";
import { clients } from "../content.ts";
import { clientsApi } from "./clients-api.ts";

const copy = clients.atFault;

/** The choice, once the reasons have come; nothing while they come, or where they cannot. */
export function AtFault(props: {
  readonly clientId: string;
  /** The reason picked, by its code; empty for No. */
  readonly value: string;
  readonly disabled?: boolean;
  readonly error?: string | null;
  readonly onChange: (reason: string) => void;
}) {
  const { clientId, onChange } = props;
  const load = useCallback(() => clientsApi.clientPieces(clientId), [clientId]);
  const [loaded] = useLoad(load);
  if (loaded.state !== "loaded" || loaded.value.failure_reasons.length === 0) return null;
  return (
    <Field label={copy.label} error={props.error ?? null}>
      {(control) => (
        <Select
          {...control}
          width="choice"
          value={props.value}
          disabled={props.disabled}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        >
          <option value="">{copy.no}</option>
          {loaded.value.failure_reasons.map((reason) => (
            <option key={reason.code} value={reason.code}>
              {copy.yes(reason.label)}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}
