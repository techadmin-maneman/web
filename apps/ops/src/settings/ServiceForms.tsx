// The forms a service's or a late fee's actions open (./Services.tsx), each shown in the block it acts on. Every one
// shows what it is now beside what it will be before anything is sent, and only the second press sends it
// (docs/decisions/0071-what-ops-see-before-a-setting-changes.md). A price's boxes start from the price in force, its
// GST included: a GST box that opened at nought once made an 18% item GST-free without anyone seeing it.

import { errorText } from "@maneman/web-kit/refusal";
import { DateInput, Field, NumberInput, TextInput } from "@maneman/ui/Field";
import { CheckPanel } from "../components/CheckPanel.tsx";
import { addDays, longDate } from "@maneman/web-kit/dates";
import { paiseFromRupees, rupees } from "@maneman/web-kit/money";
import { useState } from "react";
import { api, type Kind, type OpsService, type Price, type ServiceBook } from "../api.ts";
import { settings } from "../content/settings.ts";
import { PRICE_TIER, tierCodeOf } from "@rules/policy/services.ts";
import styles from "../components/forms.module.css";
import { Refused, SettingForm, sentOf, useSteps, type FormWords, type Sent } from "./SettingForm.tsx";

const copy = settings.services;
const form = copy.form;
const check = copy.check;

const WORDS: FormWords = {
  next: form.next,
  cancel: form.cancel,
  checkTitle: check.title,
  send: check.send,
  saving: copy.saving,
  back: check.back,
};

/** What a write answered: the book as it now stands, or the refusal, with the boxes it names. */
export type Written = Sent<{
  readonly services?: ServiceBook;
  readonly prices?: readonly Price[];
  readonly said: string;
}>;

/** What a price is set for: a service, or a late fee, by the book's item and tier, and the name ops read. */
export interface Priced {
  readonly item: Price["item"];
  readonly tier: string;
  readonly name: string;
  /** Every price it has had and is to have, newest first. */
  readonly prices: readonly Price[];
}

/** "Rs. 2,000 + 18% GST". */
export const priceWords = (price: { amount_ex_gst: number; gst_percent: number }) =>
  copy.price(rupees(price.amount_ex_gst), price.gst_percent);

/** A service's book, as a write that changes a service answers it. */
const savedBook = (services: ServiceBook) => ({ services, said: copy.done.saved });

/**
 * A new price from a day, tomorrow at the earliest, or, given `correcting`, the price still to come it corrects: taken
 * back and set again, in one go. The boxes start from the price in force, or the one corrected.
 */
export function PriceForm(props: {
  readonly target: Priced;
  readonly correcting?: Price;
  readonly today: string;
  readonly maxAmount: number;
  readonly maxGst: number;
  readonly onDone: (written: Written & { ok: true }) => void;
  readonly onCancel: () => void;
}) {
  const { target, correcting, today } = props;
  const inForce = target.prices.find((price) => price.in_force);
  const start = correcting ?? inForce;
  const [rupeesTyped, setRupees] = useState(start === undefined ? "" : String(start.amount_ex_gst / 100));
  const [gst, setGst] = useState(start === undefined ? "" : String(start.gst_percent));
  const firstDay = addDays(today, 1);
  const [from, setFrom] = useState(correcting?.valid_from ?? firstDay);
  // Rupees on the screen, paise in the book: the API and the database count in paise.
  const change = {
    item: target.item,
    tier: target.tier,
    amount_ex_gst: paiseFromRupees(rupeesTyped),
    gst_percent: Number(gst),
    valid_from: from,
  };
  const steps = useSteps(async () => {
    const answer =
      correcting === undefined
        ? await api.setPrice(change)
        : await api.correctPrice({ ...change, was_valid_from: correcting.valid_from });
    return sentOf(answer, (body) => ({ prices: body.prices, said: copy.done.price }));
  }, props.onDone);
  // A day typed before tomorrow, which the date picker's min alone does not stop.
  const tooSoon = from !== "" && from < firstDay;
  const ready = rupeesTyped.trim() !== "" && gst.trim() !== "" && from !== "" && !tooSoon;
  const was = correcting ?? inForce;
  const sameDay = target.prices.some(
    (price) => price.valid_from === change.valid_from && price.valid_from !== correcting?.valid_from,
  );

  return (
    <SettingForm
      title={
        correcting === undefined
          ? form.priceTitle(target.name)
          : form.correctTitle(target.name, longDate(correcting.valid_from))
      }
      steps={steps}
      ready={ready}
      words={{ ...WORDS, send: form.setPrice }}
      errors={copy.errors}
      onCancel={props.onCancel}
      checking={
        <>
          <p className={styles.checkLine}>
            {correcting === undefined
              ? check.price(
                  target.name,
                  was === undefined ? check.nothing : priceWords(was),
                  priceWords(change),
                  longDate(change.valid_from),
                )
              : check.correct({
                  name: target.name,
                  was: priceWords(correcting),
                  wasFrom: longDate(correcting.valid_from),
                  now: priceWords(change),
                  from: longDate(change.valid_from),
                })}
          </p>
          {was !== undefined && was.gst_percent !== change.gst_percent && (
            <p className={styles.checkWarning}>{check.gstChanges(was.gst_percent, change.gst_percent)}</p>
          )}
          {sameDay && <p className={styles.checkLine}>{check.sameDay}</p>}
        </>
      }
    >
      {inForce !== undefined && correcting === undefined && (
        <p className={styles.formNow}>{copy.now(priceWords(inForce), longDate(inForce.valid_from))}</p>
      )}
      <div className={styles.fields}>
        <Field label={form.amount} className={styles.field}>
          {(control) => (
            <NumberInput
              {...control}
              className={styles.amountBox}
              inputMode="numeric"
              step={1}
              min={0}
              max={props.maxAmount / 100}
              value={rupeesTyped}
              onChange={(event) => {
                setRupees(event.target.value);
                steps.edit();
              }}
            />
          )}
        </Field>
        <Field label={form.gst} className={styles.field}>
          {(control) => (
            <div className={styles.fieldRow}>
              <NumberInput
                {...control}
                className={styles.figureBox}
                inputMode="numeric"
                step={1}
                min={0}
                max={props.maxGst}
                value={gst}
                onChange={(event) => {
                  setGst(event.target.value);
                  steps.edit();
                }}
              />
              <span className={styles.unit}>%</span>
            </div>
          )}
        </Field>
        <Field
          label={form.from}

          error={tooSoon ? form.fromTooSoon : null}
          className={styles.field}
        >
          {(control) => (
            <DateInput
              {...control}
              className={styles.dateBox}
              min={firstDay}
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

/** Taking back a price still to come: asked once, in its block, before anything is sent. */
export function TakeBack(props: {
  readonly target: Priced;
  readonly row: Price;
  readonly onDone: (written: Written & { ok: true }) => void;
  readonly onKeep: () => void;
}) {
  const { target, row } = props;
  const steps = useSteps(async () => {
    const answer = await api.withdrawPrice({ item: target.item, tier: target.tier, valid_from: row.valid_from });
    return sentOf(answer, (body) => ({ prices: body.prices, said: copy.done.takenBack }));
  }, props.onDone);
  return (
    <>
      <CheckPanel
        lines={[check.takeBack(longDate(row.valid_from))]}
        busy={steps.step === "saving"}
        send={check.takeBackConfirm}
        sending={copy.saving}
        back={check.keep}
        onSend={steps.go}
        onBack={props.onKeep}
      />
      {steps.failed !== null && (
        <p className={styles.error} role="alert">
          {errorText({ ...copy.errors, ...copy.takeBackErrors }, steps.failed)}
        </p>
      )}
    </>
  );
}

/** A service's new name. Its code stays, so its prices, and what was sold under them, stay its own. */
export function RenameForm(props: {
  readonly service: OpsService;
  readonly onDone: (written: Written & { ok: true }) => void;
  readonly onCancel: () => void;
}) {
  const { service } = props;
  const [name, setName] = useState(service.name);
  const steps = useSteps(async () => {
    const answer = await api.renameService(service.kind, service.tier, name.trim());
    return sentOf(answer, savedBook);
  }, props.onDone);
  return (
    <SettingForm
      title={form.renameTitle(service.name)}
      steps={steps}
      ready={name.trim() !== "" && name.trim() !== service.name}
      words={WORDS}
      errors={copy.errors}
      onCancel={props.onCancel}
      checking={<p className={styles.checkLine}>{check.rename(service.name, name.trim(), service.tier)}</p>}
    >
      <div className={styles.fields}>
        <Field label={form.name} className={styles.field}>
          {(control) => (
            <TextInput
              {...control}
              className={styles.areaBox}
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
    const answer = await api.describeService(service.kind, service.tier, line.trim());
    return sentOf(answer, savedBook);
  }, props.onDone);
  return (
    <SettingForm
      title={form.describeTitle(service.name)}
      steps={steps}
      ready={line.trim() !== was}
      words={WORDS}
      errors={copy.errors}
      onCancel={props.onCancel}
      checking={<p className={styles.checkLine}>{check.describe(service.name, was, line.trim())}</p>}
    >
      <div className={styles.fields}>
        <Field label={form.description} className={styles.field}>
          {(control) => (
            <TextInput
              {...control}
              className={styles.areaBox}
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
    const answer = await api.setServiceLength(service.kind, service.tier, Number(minutes));
    return sentOf(answer, savedBook);
  }, props.onDone);
  return (
    <SettingForm
      title={form.lengthTitle(service.name)}
      steps={steps}
      ready={minutes.trim() !== "" && Number(minutes) !== service.minutes}
      words={WORDS}
      errors={copy.errors}
      onCancel={props.onCancel}
      checking={<p className={styles.checkLine}>{check.length(service.name, service.minutes, Number(minutes))}</p>}
    >
      <div className={styles.fields}>
        <Field label={form.minutes} className={styles.field}>
          {(control) => (
            <NumberInput
              {...control}
              className={styles.figureBox}
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
    const answer = await api.retireService(service.kind, service.tier, from);
    return sentOf(answer, savedBook);
  }, props.onDone);
  return (
    <SettingForm
      title={form.retireTitle(service.name)}
      steps={steps}
      ready={from !== ""}
      words={WORDS}
      errors={copy.errors}
      onCancel={props.onCancel}
      checking={<p className={styles.checkLine}>{check.retire(service.name, longDate(from))}</p>}
    >
      <div className={styles.fields}>
        <Field label={form.retireFrom} className={styles.field}>
          {(control) => (
            <DateInput
              {...control}
              className={styles.dateBox}
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
    const answer = await api.restoreService(service.kind, service.tier);
    return sentOf(answer, savedBook);
  }, props.onDone);
  return (
    <>
      <CheckPanel
        lines={[check.restore(service.name)]}
        busy={steps.step === "saving"}
        send={check.send}
        sending={copy.saving}
        back={check.back}
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
    const answer = await api.orderServices(
      props.kind,
      props.now.map((service) => service.tier),
    );
    return sentOf(answer, savedBook);
  }, props.onDone);
  return (
    <>
      <CheckPanel
        lines={[check.order(copy.kinds[props.kind] ?? props.kind, names(props.was), names(props.now))]}
        busy={steps.step === "saving"}
        send={check.send}
        sending={copy.saving}
        back={check.back}
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
  const kindName = copy.kinds[kind] ?? kind;
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [codeTyped, setCodeTyped] = useState(false);
  const [minutes, setMinutes] = useState(String(props.minutes));
  const codeSent = codeTyped ? code.trim() : (tierCodeOf(name) ?? "");
  const steps = useSteps(async () => {
    const answer = await api.addService({ kind, name: name.trim(), tier: codeSent, minutes: Number(minutes) });
    return sentOf(answer, savedBook);
  }, props.onDone);
  const ready = name.trim() !== "" && PRICE_TIER.test(codeSent) && minutes.trim() !== "";
  return (
    <SettingForm
      title={form.addTitle(kindName)}
      steps={steps}
      ready={ready}
      words={WORDS}
      errors={copy.errors}
      onCancel={props.onCancel}
      checking={<p className={styles.checkLine}>{check.add(kindName, name.trim(), Number(minutes), codeSent)}</p>}
    >
      <div className={styles.fields}>
        <Field label={form.name} className={styles.field}>
          {(control) => (
            <TextInput
              {...control}
              className={styles.areaBox}
              maxLength={60}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                steps.edit();
              }}
            />
          )}
        </Field>
        <Field label={form.code} hint={form.codeHints[kind]} className={styles.field}>
          {(control) => (
            <TextInput
              {...control}
              className={styles.areaBox}
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
        <Field label={form.minutes} className={styles.field}>
          {(control) => (
            <NumberInput
              {...control}
              className={styles.figureBox}
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
