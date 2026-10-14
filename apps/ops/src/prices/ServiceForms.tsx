// The forms a service's actions open (./Services.tsx), each shown in the block it acts on; a price's are
// ./PriceForms.tsx. Every one shows what it is now beside what it will be before anything is sent, and only the second
// press sends it (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).

import { DateInput, Field, NumberInput, TextInput } from "@maneman/ui/Field";
import { CheckPanel } from "../components/CheckPanel.tsx";
import { longDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { type Kind, type OpsService, type Price, type ServiceCatalogue } from "../api.ts";
import { settings } from "../content/settings.ts";
import { PRICE_TIER, tierCodeOf } from "@rules/policy/services.ts";
import form from "../components/forms.module.css";
import { Refused, SettingForm, sentOf, useSteps, type Sent } from "../settings/index.ts";
import { pricesApi } from "./prices-api.ts";

const copy = settings.services;
const formWords = copy.form;
const check = copy.check;

/** What a write answered: the book as it now stands, or the refusal, with the boxes it names. */
export type Written = Sent<{
  readonly services?: ServiceCatalogue;
  readonly prices?: readonly Price[];
  readonly said: string;
}>;

/** A service's book, as a write that changes a service answers it. */
const savedCatalogue = (services: ServiceCatalogue) => ({ services, said: copy.done.saved });

/** A service's new name. Its code stays, so its prices, and what was sold under them, stay its own. */
export function RenameForm(props: {
  readonly service: OpsService;
  readonly onDone: (written: Written & { ok: true }) => void;
  readonly onCancel: () => void;
}) {
  const { service } = props;
  const [name, setName] = useState(service.name);
  const steps = useSteps(async () => {
    const answer = await pricesApi.renameService(service.kind, service.tier, name.trim());
    return sentOf(answer, savedCatalogue);
  }, props.onDone);
  return (
    <SettingForm
      title={formWords.renameTitle(service.name)}
      steps={steps}
      ready={name.trim() !== "" && name.trim() !== service.name}
      errors={copy.errors}
      onCancel={props.onCancel}
      checking={<p className={form.checkLine}>{check.rename(service.name, name.trim(), service.tier)}</p>}
    >
      <div className={form.fields}>
        <Field label={formWords.name} className={form.field}>
          {(control) => (
            <TextInput
              {...control}
              className={form.areaBox}
              maxLength={60}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                steps.edit();
              }}
            />
          )}
        </Field>
      </div>
    </SettingForm>
  );
}

/** The line clients read under a service's name as they choose. Left empty, they read the name alone. */
export function DescribeForm(props: {
  readonly service: OpsService;
  readonly maxLength: number;
  readonly onDone: (written: Written & { ok: true }) => void;
  readonly onCancel: () => void;
}) {
  const { service } = props;
  const was = service.description ?? "";
  const [line, setLine] = useState(was);
  const steps = useSteps(async () => {
    const answer = await pricesApi.describeService(service.kind, service.tier, line.trim());
    return sentOf(answer, savedCatalogue);
  }, props.onDone);
  return (
    <SettingForm
      title={formWords.describeTitle(service.name)}
      steps={steps}
      ready={line.trim() !== was}
      errors={copy.errors}
      onCancel={props.onCancel}
      checking={<p className={form.checkLine}>{check.describe(service.name, was, line.trim())}</p>}
    >
      <div className={form.fields}>
        <Field label={formWords.description} className={form.field}>
          {(control) => (
            <TextInput
              {...control}
              className={form.areaBox}
              maxLength={props.maxLength}
              value={line}
              onChange={(event) => {
                setLine(event.target.value);
                steps.edit();
              }}
            />
          )}
        </Field>
      </div>
    </SettingForm>
  );
}

/** How long a service is booked for, from now on, inside the bounds the API gives. */
export function LengthForm(props: {
  readonly service: OpsService;
  readonly bounds: { readonly min: number; readonly max: number };
  readonly onDone: (written: Written & { ok: true }) => void;
  readonly onCancel: () => void;
}) {
  const { service, bounds } = props;
  const [minutes, setMinutes] = useState(String(service.minutes));
  const steps = useSteps(async () => {
    const answer = await pricesApi.setServiceLength(service.kind, service.tier, Number(minutes));
    return sentOf(answer, savedCatalogue);
  }, props.onDone);
  return (
    <SettingForm
      title={formWords.lengthTitle(service.name)}
      steps={steps}
      ready={minutes.trim() !== "" && Number(minutes) !== service.minutes}
      errors={copy.errors}
      onCancel={props.onCancel}
      checking={<p className={form.checkLine}>{check.length(service.name, service.minutes, Number(minutes))}</p>}
    >
      <div className={form.fields}>
        <Field label={formWords.minutes} className={form.field}>
          {(control) => (
            <NumberInput
              {...control}
              className={form.figureBox}
              inputMode="numeric"
              step={1}
              min={bounds.min}
              max={bounds.max}
              value={minutes}
              onChange={(event) => {
                setMinutes(event.target.value);
                steps.edit();
              }}
            />
          )}
        </Field>
      </div>
    </SettingForm>
  );
}

/** Stops offering a service from a day, today or later; the API keeps every kind one service to book. */
export function RetireForm(props: {
  readonly service: OpsService;
  readonly today: string;
  readonly onDone: (written: Written & { ok: true }) => void;
  readonly onCancel: () => void;
}) {
  const { service, today } = props;
  const [from, setFrom] = useState(today);
  const steps = useSteps(async () => {
    const answer = await pricesApi.retireService(service.kind, service.tier, from);
    return sentOf(answer, savedCatalogue);
  }, props.onDone);
  return (
    <SettingForm
      title={formWords.retireTitle(service.name)}
      steps={steps}
      ready={from !== ""}
      errors={copy.errors}
      onCancel={props.onCancel}
      checking={<p className={form.checkLine}>{check.retire(service.name, longDate(from))}</p>}
    >
      <div className={form.fields}>
        <Field label={formWords.retireFrom} className={form.field}>
          {(control) => (
            <DateInput
              {...control}
              className={form.dateBox}
              min={today}
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                steps.edit();
              }}
            />
          )}
        </Field>
      </div>
    </SettingForm>
  );
}

/** Offers a retired service again, or takes back a retirement still to come: asked once. */
export function RestoreCheck(props: {
  readonly service: OpsService;
  readonly onDone: (written: Written & { ok: true }) => void;
  readonly onKeep: () => void;
}) {
  const { service } = props;
  const steps = useSteps(async () => {
    const answer = await pricesApi.restoreService(service.kind, service.tier);
    return sentOf(answer, savedCatalogue);
  }, props.onDone);
  return (
    <>
      <CheckPanel
        question={check.restore(service.name)}
        busy={steps.step === "saving"}
        onSend={steps.go}
        onBack={props.onKeep}
      />
      <Refused failed={steps.failed} errors={copy.errors} />
    </>
  );
}

/** A kind's services in a new order, shown beside the old before it is sent. */
export function OrderCheck(props: {
  readonly kind: Kind;
  readonly was: readonly OpsService[];
  readonly now: readonly OpsService[];
  readonly onDone: (written: Written & { ok: true }) => void;
  readonly onKeep: () => void;
}) {
  const names = (services: readonly OpsService[]) => services.map((service) => service.name).join(", ");
  const steps = useSteps(async () => {
    const answer = await pricesApi.orderServices(
      props.kind,
      props.now.map((service) => service.tier),
    );
    return sentOf(answer, savedCatalogue);
  }, props.onDone);
  return (
    <>
      <CheckPanel
        lines={[check.order(copy.kinds[props.kind], names(props.was), names(props.now))]}
        busy={steps.step === "saving"}
        onSend={steps.go}
        onBack={props.onKeep}
      />
      <Refused failed={steps.failed} errors={copy.errors} />
    </>
  );
}

/** A service added to a kind: its name, the code made from it, and its length, which starts at the kind's. */
export function AddForm(props: {
  readonly kind: Kind;
  readonly minutes: number;
  readonly bounds: { readonly min: number; readonly max: number };
  readonly onDone: (written: Written & { ok: true }) => void;
  readonly onCancel: () => void;
}) {
  const { kind, bounds } = props;
  const kindName = copy.kinds[kind];
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [codeTyped, setCodeTyped] = useState(false);
  const [minutes, setMinutes] = useState(String(props.minutes));
  const codeSent = codeTyped ? code.trim() : (tierCodeOf(name) ?? "");
  const steps = useSteps(async () => {
    const answer = await pricesApi.addService({ kind, name: name.trim(), tier: codeSent, minutes: Number(minutes) });
    return sentOf(answer, savedCatalogue);
  }, props.onDone);
  const ready = name.trim() !== "" && PRICE_TIER.test(codeSent) && minutes.trim() !== "";
  return (
    <SettingForm
      title={formWords.addTitle(kindName)}
      steps={steps}
      ready={ready}
      errors={copy.errors}
      onCancel={props.onCancel}
      checking={<p className={form.checkLine}>{check.add(kindName, name.trim(), Number(minutes), codeSent)}</p>}
    >
      <div className={form.fields}>
        <Field label={formWords.name} className={form.field}>
          {(control) => (
            <TextInput
              {...control}
              className={form.areaBox}
              maxLength={60}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                steps.edit();
              }}
            />
          )}
        </Field>
        <Field label={formWords.code} hint={formWords.codeHints[kind]} className={form.field}>
          {(control) => (
            <TextInput
              {...control}
              className={form.areaBox}
              maxLength={32}
              value={codeTyped ? code : (tierCodeOf(name) ?? "")}
              onChange={(event) => {
                setCode(event.target.value);
                setCodeTyped(true);
                steps.edit();
              }}
            />
          )}
        </Field>
        <Field label={formWords.minutes} className={form.field}>
          {(control) => (
            <NumberInput
              {...control}
              className={form.figureBox}
              inputMode="numeric"
              step={1}
              min={bounds.min}
              max={bounds.max}
              value={minutes}
              onChange={(event) => {
                setMinutes(event.target.value);
                steps.edit();
              }}
            />
          )}
        </Field>
      </div>
    </SettingForm>
  );
}
