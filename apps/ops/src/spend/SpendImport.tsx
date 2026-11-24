// Spend taken from an ad account's report (docs/decisions/0288-attribution-and-conversions.md): the account, then its
// CSV broken down by day, read here and shown as its rows and total before it is imported. Each campaign's city is
// the one its name starts with, as the Spend page's own entries say.

import { SubmitButton } from "@maneman/ui/SubmitButton";
import { ACTION_ICONS } from "@maneman/brand/action-icons";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { CancelButton } from "@maneman/ui/CancelButton";
import { FormActions } from "@maneman/ui/FormActions";
import { Field, FileInput, Select } from "@maneman/ui/Field";
import { describedBy, Missing } from "@maneman/ui/Missing";
import { Note } from "@maneman/ui/Note";
import { Refused } from "@maneman/ui/Refusal";
import { rupees } from "@maneman/web-kit/money";
import { type Failure } from "@maneman/web-kit/refusal";
import { useState } from "react";
import form from "@maneman/ui/forms.module.css";
import { spend as copy } from "../content/spend.ts";
import { readSpendCsv, type SpendRead } from "./spend-csv.ts";
import { spendApi } from "./spend-api.ts";

type Platform = "google" | "meta";

/** What the file read says: its rows and total, or why it cannot be imported. */
function readWords(read: SpendRead): string {
  if (read.ok) return copy.import.read(read.rows.length, rupees(read.rows.reduce((sum, row) => sum + row.amount, 0)));
  if (read.reason === "day") return copy.import.day(read.line);
  return copy.import[read.reason];
}

export function SpendImport(props: { onImported: (rows: number) => void; onCancel: () => void }) {
  const [platform, setPlatform] = useState<Platform>("google");
  const [read, setRead] = useState<SpendRead | null>(null);
  const [busy, once] = useOneAtATime();
  const [failure, setFailure] = useState<Failure | null>(null);
  const submit = () =>
    once(async () => {
      if (read?.ok !== true) return;
      setFailure(null);
      const answer = await spendApi.import({ platform, rows: [...read.rows] });
      if (answer.ok) props.onImported(answer.body.added);
      else setFailure({ code: answer.code, fields: answer.fields });
    });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className={form.fields}>
        <Field label={copy.import.platform} className={form.field}>
          {(control) => (
            <Select
              {...control}
              width="choice"
              value={platform}
              onChange={(event) => {
                setPlatform(event.target.value === "meta" ? "meta" : "google");
              }}
            >
              <option value="google">{copy.import.platforms.google}</option>
              <option value="meta">{copy.import.platforms.meta}</option>
            </Select>
          )}
        </Field>
        <Field
          label={copy.import.file}
          hint={copy.import.fileHint}
          className={form.field}
          error={read === null || read.ok ? null : readWords(read)}
        >
          {(control) => (
            <FileInput
              {...control}
              className={form.file}
              accept=".csv,text/csv"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file !== undefined) {
                  void file.text().then((text) => {
                    setRead(readSpendCsv(text));
                  });
                }
              }}
            />
          )}
        </Field>
        {read?.ok === true && <Note>{readWords(read)}</Note>}
      </div>
      <Refused failed={failure} errors={copy.errors} boxes={["rows"]} />
      <FormActions>
        <SubmitButton
          icon={ACTION_ICONS.upload}
          busy={busy}
          disabled={read?.ok !== true}
          aria-describedby={describedBy("import-missing", read === null)}
        >
          {busy ? copy.import.importing : copy.import.submit}
        </SubmitButton>
        <CancelButton disabled={busy} onClick={props.onCancel} />
      </FormActions>
      <Missing id="import-missing" what={read === null ? copy.import.missing : null} />
    </form>
  );
}
