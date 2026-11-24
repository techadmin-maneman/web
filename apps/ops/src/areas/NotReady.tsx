// A launch refused because its city is not ready (no one trained to fit, or no stockroom): an Admin may serve it all
// the same, with why (docs/decisions/0221-launches-scheduled-paused-and-checked.md).

import { ACTION_ICONS } from "@maneman/brand/action-icons";
import { Button } from "@maneman/ui/Button";
import { Field, TextInput } from "@maneman/ui/Field";
import { FormActions } from "@maneman/ui/FormActions";
import { useState } from "react";
import { areas } from "../content.ts";
import type { AreaChange } from "../api.ts";
import { useAccess } from "../lib/access.ts";
import type { Saving } from "./useAreaSaves.ts";
import form from "@maneman/ui/forms.module.css";

const copy = areas.notReady;

/** Shown after a refusal for a city not ready, and only to a national Admin, whose call it is. */
export function NotReady({
  saving,
  onLaunch,
}: {
  saving: Saving;
  onLaunch: (changes: readonly AreaChange[], reason: string) => void;
}) {
  const access = useAccess();
  const [reason, setReason] = useState("");
  if (saving.step !== "failed" || saving.code !== "not_ready") return null;
  if (!access.reaches({ department: "admin", level: "manage" })) return null;
  const { changes } = saving;
  return (
    <>
      <div className={form.fields}>
        <Field label={copy.label} className={form.wide}>
          {(control) => (
            <TextInput
              {...control}
              maxLength={300}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
          )}
        </Field>
      </div>
      <FormActions>
        <Button
          icon={ACTION_ICONS.rocket}
          variant="outline"
          size="small"
          disabled={reason.trim() === ""}
          onClick={() => {
            onLaunch(changes, reason.trim());
          }}
        >
          {copy.launch}
        </Button>
      </FormActions>
    </>
  );
}
