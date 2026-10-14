// A price's forms, opened from a service's or a late fee's block (./Services.tsx): a new price from a day, or one still
// to come taken back. Its boxes start from the price in force, its GST included: a GST box that opened at nought once
// made an 18% item GST-free without anyone seeing it (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).

import { errorText } from "@maneman/web-kit/refusal";
import { DateInput, Field, NumberInput } from "@maneman/ui/Field";
import { CheckPanel } from "../components/CheckPanel.tsx";
import { addDays, longDate } from "@maneman/web-kit/dates";
import { paiseFromRupees, rupees, rupeesTyped } from "@maneman/web-kit/money";
import { useState } from "react";
import { type Price } from "../api.ts";
import { settings } from "../content/settings.ts";
import form from "../components/forms.module.css";
import styles from "./prices.module.css";
import { SettingForm, sentOf, useSteps } from "../settings/index.ts";
import { Refusal } from "../components/Refusal.tsx";

import type { Written } from "./ServiceForms.tsx";
import { pricesApi } from "./prices-api.ts";

const copy = settings.services;
const formWords = copy.form;
const check = copy.check;

/** What a price is set for: a service, or a late fee, by the book's item and tier, and the name ops read. */
export interface Priced {
  readonly item: Price["item"];
  readonly tier: string;
  readonly name: string;
  /** Every price it has had and is to have, newest first. */
  readonly prices: readonly Price[];
}

/** "Rs. 1,234 + 18% GST". */
export const priceWords = (price: { amount_ex_gst: number; gst_percent: number }) =>
  copy.price(rupees(price.amount_ex_gst), price.gst_percent);

/** What the check says: the price as it was beside what it will be, a GST that changes, and a day already priced. */
function PriceCheck(props: {
  target: Priced;
  correcting: Price | undefined;
  was: Price | undefined;
  change: { amount_ex_gst: number; gst_percent: number; valid_from: string };
  sameDay: boolean;
}) {
  const { target, correcting, was, change } = props;
  return (
    <>
      <p className={form.checkLine}>
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
        <p className={form.checkWarning}>{check.gstChanges(was.gst_percent, change.gst_percent)}</p>
      )}
      {props.sameDay && <p className={form.checkLine}>{check.sameDay}</p>}
    </>
  );
}

/** The price before GST in whole rupees, its GST, and the day it applies from. */
function PriceBoxes(props: {
  typed: { rupees: string; gst: string; from: string };
  firstDay: string;
  tooSoon: boolean;
  maxAmount: number;
  maxGst: number;
  onRupees: (value: string) => void;
  onGst: (value: string) => void;
  onFrom: (value: string) => void;
}) {
  const { typed, firstDay, tooSoon, maxAmount, maxGst, onRupees, onGst, onFrom } = props;
  return (
    <div className={form.fields}>
      <Field label={formWords.amount} className={form.field}>
        {(control) => (
          <NumberInput
            {...control}
            className={form.amountBox}
            inputMode="numeric"
            step={1}
            min={0}
            max={maxAmount / 100}
            value={typed.rupees}
            onChange={(event) => {
              onRupees(event.target.value);
            }}
          />
        )}
      </Field>
      <Field label={formWords.gst} className={form.field}>
        {(control) => (
          <div className={form.fieldRow}>
            <NumberInput
              {...control}
              className={form.figureBox}
              inputMode="numeric"
              step={1}
              min={0}
              max={maxGst}
              value={typed.gst}
              onChange={(event) => {
                onGst(event.target.value);
              }}
            />
            <span className={form.unit}>%</span>
          </div>
        )}
      </Field>
      <Field label={formWords.from} error={tooSoon ? formWords.fromTooSoon : null} className={form.field}>
        {(control) => (
          <DateInput
            {...control}
            className={form.dateBox}
            min={firstDay}
            value={typed.from}
            onChange={(event) => {
              onFrom(event.target.value);
            }}
          />
        )}
      </Field>
    </div>
  );
}

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
  const [typedRupees, setRupees] = useState(start === undefined ? "" : rupeesTyped(start.amount_ex_gst));
  const [gst, setGst] = useState(start === undefined ? "" : String(start.gst_percent));
  const firstDay = addDays(today, 1);
  const [from, setFrom] = useState(correcting?.valid_from ?? firstDay);
  // Rupees on the screen, paise in the book: the API and the database count in paise.
  const change = {
    item: target.item,
    tier: target.tier,
    amount_ex_gst: paiseFromRupees(typedRupees),
    gst_percent: Number(gst),
    valid_from: from,
  };
  const steps = useSteps(async () => {
    const answer =
      correcting === undefined
        ? await pricesApi.setPrice(change)
        : await pricesApi.correctPrice({ ...change, was_valid_from: correcting.valid_from });
    return sentOf(answer, (body) => ({ prices: body.prices, said: copy.done.price }));
  }, props.onDone);
  // A day typed before tomorrow, which the date picker's min alone does not stop.
  const tooSoon = from !== "" && from < firstDay;
  const ready = typedRupees.trim() !== "" && gst.trim() !== "" && from !== "" && !tooSoon;
  const was = correcting ?? inForce;
  const sameDay = target.prices.some(
    (price) => price.valid_from === change.valid_from && price.valid_from !== correcting?.valid_from,
  );

  return (
    <SettingForm
      title={
        correcting === undefined
          ? formWords.priceTitle(target.name)
          : formWords.correctTitle(target.name, longDate(correcting.valid_from))
      }
      steps={steps}
      ready={ready}
      errors={copy.errors}
      onCancel={props.onCancel}
      checking={<PriceCheck target={target} correcting={correcting} was={was} change={change} sameDay={sameDay} />}
    >
      {inForce !== undefined && correcting === undefined && (
        <p className={styles.formNow}>{copy.now(priceWords(inForce), longDate(inForce.valid_from))}</p>
      )}
      <PriceBoxes
        typed={{ rupees: typedRupees, gst, from }}
        firstDay={firstDay}
        tooSoon={tooSoon}
        maxAmount={props.maxAmount}
        maxGst={props.maxGst}
        onRupees={(value) => {
          setRupees(value);
          steps.edit();
        }}
        onGst={(value) => {
          setGst(value);
          steps.edit();
        }}
        onFrom={(value) => {
          setFrom(value);
          steps.edit();
        }}
      />
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
    const answer = await pricesApi.withdrawPrice({
      item: target.item,
      tier: target.tier,
      valid_from: row.valid_from,
    });
    return sentOf(answer, (body) => ({ prices: body.prices, said: copy.done.takenBack }));
  }, props.onDone);
  return (
    <>
      <CheckPanel
        question={check.takeBack(longDate(row.valid_from))}
        busy={steps.step === "saving"}
        onSend={steps.go}
        onBack={props.onKeep}
      />
      {steps.failed !== null && (
        <Refusal className={form.error} said={errorText({ ...copy.errors, ...copy.takeBackErrors }, steps.failed)} />
      )}
    </>
  );
}
