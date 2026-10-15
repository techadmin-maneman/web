// Making discount codes (docs/decisions/0108-discount-codes.md): one code typed, or a batch generated; what each takes
// off before GST, what it covers, and its limits. The draft and the check's lines are ./discount-draft.ts; nothing is
// made until the check has been read and the second press made (ADR 0071).

import { CheckLine } from "../components/CheckPanel.tsx";
import { Checkbox, ChoiceGroup, DateInput, Field, NumberInput, Select, TextInput } from "@maneman/ui/Field";
import { useState } from "react";
import { CODE_LENGTH } from "@rules/policy/discount-codes.ts";
import { settings } from "../content/settings.ts";
import {
  checkLines,
  codeError,
  COVERS,
  EMPTY,
  isBatch,
  isReady,
  requestOf,
  type Covered,
  type Draft,
} from "./discount-draft.ts";
import { SettingForm, sentOf, useSteps } from "../settings/index.ts";
import form from "../components/forms.module.css";
import { discountCodesApi } from "./discount-codes-api.ts";

const copy = settings.discountCodes;

/** A change to some of the draft's boxes. */
type Edit = (change: Partial<Draft>) => void;

/** One code ops type, or how many are generated. */
function WhatIsMade({ draft, most, edit }: { draft: Draft; most: number; edit: Edit }) {
  return (
    <div className={form.fields}>
      <Field label={copy.how} className={form.field}>
        {(control) => (
          <Select
            {...control}
            width="choice"
            value={draft.how}
            onChange={(event) => {
              edit({ how: event.target.value === "generated" ? "generated" : "typed" });
            }}
          >
            <option value="typed">{copy.typed}</option>
            <option value="generated">{copy.generated}</option>
          </Select>
        )}
      </Field>
      {draft.how === "typed" ? (
        <Field
          label={copy.code}
          box="code"

          error={codeError(draft)}
          className={form.field}
        >
          {(control) => (
            <TextInput
              {...control}
              width="area"
              autoCapitalize="characters"
              maxLength={CODE_LENGTH.max}
              value={draft.code}
              onChange={(event) => {
                edit({ code: event.target.value });
              }}
            />
          )}
        </Field>
      ) : (
        <Field label={copy.count} className={form.field} box="count">
          {(control) => (
            <NumberInput
              {...control}
              width="figure"
              min={1}
              max={most}
              value={draft.count}
              onChange={(event) => {
                edit({ count: event.target.value });
              }}
            />
          )}
        </Field>
      )}
    </div>
  );
}

/** What each code takes off: a percentage with an optional cap, or an amount. */
function WhatItTakesOff({ draft, edit }: { draft: Draft; edit: Edit }) {
  return (
    <div className={form.fields}>
      <Field label={copy.takesOff} className={form.field} box="kind">
        {(control) => (
          <Select
            {...control}
            width="choice"
            value={draft.kind}
            onChange={(event) => {
              edit({ kind: event.target.value === "amount" ? "amount" : "percent", cap: "" });
            }}
          >
            <option value="percent">{copy.percent}</option>
            <option value="amount">{copy.amount}</option>
          </Select>
        )}
      </Field>
      <Field label={draft.kind === "percent" ? copy.value : copy.rupeesOff} className={form.field} box="value">
        {(control) => (
          <NumberInput
            {...control}
            width={draft.kind === "amount" ? "amount" : "figure"}
            min={1}
            max={draft.kind === "percent" ? 100 : undefined}
            value={draft.value}
            onChange={(event) => {
              edit({ value: event.target.value });
            }}
          />
        )}
      </Field>
      {draft.kind === "percent" && (
        <Field label={copy.cap} className={form.field} box="cap">
          {(control) => (
            <NumberInput
              {...control}
              width="amount"
              min={1}
              value={draft.cap}
              onChange={(event) => {
                edit({ cap: event.target.value });
              }}
            />
          )}
        </Field>
      )}
    </div>
  );
}

/** What it covers: a box for each kind of visit. */
function Covers({ draft, edit }: { draft: Draft; edit: Edit }) {
  const toggle = (kind: Covered) => {
    const covered = draft.covers.includes(kind);
    edit({ covers: covered ? draft.covers.filter((each) => each !== kind) : [...draft.covers, kind] });
  };
  return (
    <ChoiceGroup className={form.choices} legend={copy.covers}>
      {COVERS.map((kind) => (
        <Checkbox
          key={kind}
          label={copy.coverNames[kind]}
          checked={draft.covers.includes(kind)}
          onChange={() => {
            toggle(kind);
          }}
        />
      ))}
    </ChoiceGroup>
  );
}

/** Its limits: the last day, how many bookings each code may be on, and once per client. */
function Limits({ draft, today, edit }: { draft: Draft; today: string; edit: Edit }) {
  return (
    <>
      <div className={form.fields}>
        <Field label={copy.expires} className={form.field} box="expires_on">
          {(control) => (
            <DateInput
              {...control}
              width="date"
              min={today}
              value={draft.expiresOn}
              onChange={(event) => {
                edit({ expiresOn: event.target.value });
              }}
            />
          )}
        </Field>
        {!isBatch(draft) && (
          <Field label={copy.maxUses} className={form.field} box="max_uses">
            {(control) => (
              <NumberInput
                {...control}
                width="figure"
                min={1}
                value={draft.maxUses}
                onChange={(event) => {
                  edit({ maxUses: event.target.value });
                }}
              />
            )}
          </Field>
        )}
      </div>

      <Checkbox
        className={form.once}
        label={copy.oncePerClient}
        checked={draft.oncePerClient}
        onChange={(event) => {
          edit({ oncePerClient: event.target.checked });
        }}
      />
    </>
  );
}

export function DiscountCodeForm({
  today,
  most,
  onMade,
  onClose,
}: {
  today: string;
  most: number;
  onMade: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [made, setMade] = useState<readonly string[] | null>(null);
  const steps = useSteps(
    async () => sentOf(await discountCodesApi.makeDiscountCodes(requestOf(draft)), (body) => ({ codes: body.codes })),
    (sent) => {
      setDraft(EMPTY);
      setMade(sent.codes);
      steps.edit();
      onMade();
    },
  );
  const edit: Edit = (change) => {
    setDraft({ ...draft, ...change });
    setMade(null);
    steps.edit();
  };

  return (
    <SettingForm
      said={made === null ? null : copy.made(made)}
      title={copy.make}
      steps={steps}
      ready={isReady(draft)}
      errors={copy.errors}
      onCancel={onClose}
      boxes={["code", "count", "kind", "value", "cap", "expires_on", "max_uses"]}
      checking={
        steps.step === "editing"
          ? null
          : checkLines(draft, requestOf(draft)).map((line) => <CheckLine key={line}>{line}</CheckLine>)
      }
    >
      <WhatIsMade draft={draft} most={most} edit={edit} />
      <WhatItTakesOff draft={draft} edit={edit} />
      <Covers draft={draft} edit={edit} />
      <Limits draft={draft} today={today} edit={edit} />
    </SettingForm>
  );
}
