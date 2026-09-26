// The price book (docs/decisions/0061-ops-editable-inputs.md). Every price the
// app charges is a row here, and a change is a new row from the day it applies,
// so an invoice already issued keeps the figure it was issued under.
//
// The table therefore shows all three states at once -- past, in force, still
// to come -- because a price set for next month is a decision somebody has to
// be able to see and take back before it lands. The form starts from the price
// in force for the item and tier chosen, and shows the old figure beside the
// new before anything is sent: a GST box that opened at nought once made an
// 18% item GST-free without anyone seeing it
// (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).

import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { longDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useEffect, useRef, useState } from "react";
import { api, type Price } from "../api.ts";
import { settings } from "../content.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "./settings.module.css";

const copy = settings.prices;
const form = copy.form;

/** The Tier select's last choice. No tier can be called this: the API's names start with a letter. */
const NEW_TIER = "+new";
/** A tier's name, as the API's PRICE_TIER takes it (src/config/ops-settings.ts). */
const TIER_NAME = /^[a-z][a-z0-9_]{0,31}$/;

/** A refusal, said of the box it names where it names one (src/routes/ops-settings.ts). */
function refusalOf(
  errors: Readonly<Record<string, string>>,
  failure: { readonly code: string; readonly fields: readonly string[] },
): string | undefined {
  const [field] = failure.fields;
  if (failure.code === "invalid_request" && field !== undefined) return errors[field] ?? copy.errors.unknown;
  return errors[failure.code] ?? copy.errors.unknown;
}

const itemName = (item: string) => copy.items[item] ?? item;

/** "Rs. 2,000 + 18% GST". */
const priceWords = (price: { amount_ex_gst: number; gst_percent: number }) =>
  copy.price(rupees(price.amount_ex_gst), price.gst_percent);

/** Which of the three a row is: the one that applies today, one still to come, or one that is spent. */
function stateOf(price: Price, today: string): "inForce" | "scheduled" | "spent" {
  if (price.in_force) return "inForce";
  return price.valid_from > today ? "scheduled" : "spent";
}

const inForce = (prices: readonly Price[], item: string, tier: string) =>
  prices.find((price) => price.item === item && price.tier === tier && price.in_force);

/**
 * What the boxes start from for an item and tier: the price in force. A tier
 * the book has never priced starts with no amount and the GST the item has
 * elsewhere, since GST follows what is sold, not the base it is sold on.
 */
function startingFigures(prices: readonly Price[], item: string, tier: string): { rupees: string; gst: string } {
  const now = inForce(prices, item, tier);
  if (now !== undefined) return { rupees: String(now.amount_ex_gst / 100), gst: String(now.gst_percent) };
  const elsewhere = prices.find((price) => price.item === item && price.in_force);
  return { rupees: "", gst: elsewhere === undefined ? "" : String(elsewhere.gst_percent) };
}

type Step =
  | { readonly step: "editing" | "checking" | "saving" | "saved" }
  | { readonly step: "failed"; readonly code: string; readonly fields: readonly string[] };

interface Change {
  readonly item: Price["item"];
  readonly tier: string;
  readonly amount_ex_gst: number;
  readonly gst_percent: number;
  readonly valid_from: string;
}

/** The old figure beside the new, and what else the change does, before it is sent. */
function Check({
  change,
  prices,
  busy,
  onSend,
  onBack,
}: {
  change: Change;
  prices: readonly Price[];
  busy: boolean;
  onSend: () => void;
  onBack: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
  }, []);
  const was = inForce(prices, change.item, change.tier);
  const sameDay = prices.some(
    (price) => price.item === change.item && price.tier === change.tier && price.valid_from === change.valid_from,
  );
  return (
    <div className={styles.check} ref={panel} tabIndex={-1} role="group" aria-labelledby="price-check">
      <p className={styles.checkTitle} id="price-check">
        {form.confirm.title}
      </p>
      <p className={styles.checkLine}>
        {form.confirm.change(
          itemName(change.item),
          change.tier,
          was === undefined ? form.confirm.nothing : priceWords(was),
          priceWords(change),
          longDate(change.valid_from),
        )}
      </p>
      {was !== undefined && was.gst_percent !== change.gst_percent && (
        <p className={styles.checkWarning}>{form.confirm.gstChanges(was.gst_percent, change.gst_percent)}</p>
      )}
      {sameDay && <p className={styles.checkLine}>{form.confirm.sameDay}</p>}
      <div className={styles.actions}>
        <button className={styles.save} type="button" disabled={busy} onClick={onSend}>
          {busy ? form.saving : form.confirm.send}
        </button>
        <button className={styles.quiet} type="button" disabled={busy} onClick={onBack}>
          {form.confirm.back}
        </button>
      </div>
    </div>
  );
}

function Form({
  prices,
  today,
  maxAmount,
  maxGst,
  onSet,
}: {
  prices: readonly Price[];
  today: string;
  maxAmount: number;
  maxGst: number;
  onSet: (prices: readonly Price[]) => void;
}) {
  const items = [...new Set(prices.map((price) => price.item))];
  const tiers = [...new Set(prices.map((price) => price.tier))];
  const firstItem = items[0];
  const firstTier = tiers[0] ?? "standard";

  const [item, setItem] = useState<Price["item"] | undefined>(firstItem);
  const [tier, setTier] = useState(firstTier);
  const [newTier, setNewTier] = useState("");
  const [figures, setFigures] = useState(() =>
    firstItem === undefined ? { rupees: "", gst: "" } : startingFigures(prices, firstItem, firstTier),
  );
  const [from, setFrom] = useState(today);
  const [step, setStep] = useState<Step>({ step: "editing" });

  const tierSent = tier === NEW_TIER ? newTier.trim() : tier;
  const ready =
    item !== undefined &&
    TIER_NAME.test(tierSent) &&
    figures.rupees.trim() !== "" &&
    figures.gst.trim() !== "" &&
    from !== "";
  const now = item === undefined ? undefined : inForce(prices, item, tierSent);
  const checking = step.step === "checking" || step.step === "saving";

  const choose = (nextItem: Price["item"], nextTier: string) => {
    setItem(nextItem);
    setTier(nextTier);
    setFigures(startingFigures(prices, nextItem, nextTier === NEW_TIER ? "" : nextTier));
    setStep({ step: "editing" });
  };

  const change: Change | null =
    item === undefined
      ? null
      : {
          item,
          tier: tierSent,
          // Rupees on the screen, paise in the book: the API and the database count in paise.
          amount_ex_gst: Math.round(Number(figures.rupees) * 100),
          gst_percent: Number(figures.gst),
          valid_from: from,
        };

  const send = async () => {
    if (change === null) return;
    setStep({ step: "saving" });
    const answer = await api.setPrice(change);
    if (!answer.ok) {
      setStep({ step: "failed", code: answer.code, fields: answer.fields });
      return;
    }
    onSet(answer.body.prices);
    setStep({ step: "saved" });
  };

  return (
    <fieldset className={styles.group}>
      <legend className={styles.ruleTitle}>{form.title}</legend>
      <div className={styles.fields}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="price-item">
            {form.item}
          </label>
          <select
            className={styles.select}
            id="price-item"
            value={item}
            onChange={(event) => {
              const chosen = items.find((each) => each === event.target.value);
              if (chosen !== undefined) choose(chosen, tier);
            }}
          >
            {items.map((each) => (
              <option key={each} value={each}>
                {itemName(each)}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="price-tier">
            {form.tier}
          </label>
          <select
            className={styles.select}
            id="price-tier"
            value={tier}
            onChange={(event) => {
              if (item !== undefined) choose(item, event.target.value);
            }}
          >
            {tiers.map((each) => (
              <option key={each} value={each}>
                {each}
              </option>
            ))}
            <option value={NEW_TIER}>{form.newTier}</option>
          </select>
        </div>
        {tier === NEW_TIER && (
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="price-new-tier">
              {form.newTierName}
            </label>
            <input
              className={styles.text}
              id="price-new-tier"
              type="text"
              maxLength={32}
              value={newTier}
              aria-describedby="price-new-tier-hint"
              onChange={(event) => {
                setNewTier(event.target.value);
                setStep({ step: "editing" });
              }}
            />
            <p className={styles.hint} id="price-new-tier-hint">
              {form.newTierHint}
            </p>
          </div>
        )}
      </div>
      <p className={styles.formNow} role="status">
        {now === undefined ? form.none : form.now(priceWords(now), longDate(now.valid_from))}
      </p>
      <div className={styles.fields}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="price-amount">
            {form.amount}
          </label>
          <input
            className={`${styles.number ?? ""} ${styles.amount ?? ""}`}
            id="price-amount"
            type="number"
            inputMode="numeric"
            step={1}
            min={0}
            max={maxAmount / 100}
            value={figures.rupees}
            aria-describedby="price-amount-hint"
            onChange={(event) => {
              setFigures({ ...figures, rupees: event.target.value });
              setStep({ step: "editing" });
            }}
          />
          <p className={styles.hint} id="price-amount-hint">
            {form.amountHint(rupees(maxAmount))}
          </p>
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="price-gst">
            {form.gst}
          </label>
          <div className={styles.fieldRow}>
            <input
              className={styles.number}
              id="price-gst"
              type="number"
              inputMode="numeric"
              step={1}
              min={0}
              max={maxGst}
              value={figures.gst}
              aria-describedby="price-gst-hint"
              onChange={(event) => {
                setFigures({ ...figures, gst: event.target.value });
                setStep({ step: "editing" });
              }}
            />
            <span className={styles.unit}>%</span>
          </div>
          <p className={styles.hint} id="price-gst-hint">
            {form.gstHint(maxGst)}
          </p>
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="price-from">
            {form.from}
          </label>
          <input
            className={styles.date}
            id="price-from"
            type="date"
            min={today}
            value={from}
            aria-describedby="price-from-hint"
            onChange={(event) => {
              setFrom(event.target.value);
              setStep({ step: "editing" });
            }}
          />
          <p className={styles.hint} id="price-from-hint">
            {form.fromHint}
          </p>
        </div>
      </div>
      {checking && change !== null && (
        <Check
          change={change}
          prices={prices}
          busy={step.step === "saving"}
          onSend={() => void send()}
          onBack={() => {
            setStep({ step: "editing" });
          }}
        />
      )}
      {!checking && (
        <div className={styles.actions}>
          <button
            className={styles.save}
            type="button"
            disabled={!ready}
            onClick={() => {
              setStep({ step: "checking" });
            }}
          >
            {form.save}
          </button>
        </div>
      )}
      {step.step === "saved" && (
        <p className={styles.saved} role="status">
          {form.saved}
        </p>
      )}
      {step.step === "failed" && (
        <p className={styles.error} role="alert">
          {refusalOf(copy.errors, step)}
        </p>
      )}
    </fieldset>
  );
}

type Withdrawing =
  | { readonly step: "asking" | "sending"; readonly price: Price }
  | { readonly step: "done" }
  | { readonly step: "failed"; readonly code: string; readonly fields: readonly string[] };

/** Taking back a price still to come: asked once, beneath the table, before anything is sent. */
function Withdraw({
  withdrawing,
  onSend,
  onKeep,
}: {
  withdrawing: { readonly step: "asking" | "sending"; readonly price: Price };
  onSend: () => void;
  onKeep: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
  }, []);
  const busy = withdrawing.step === "sending";
  return (
    <div className={styles.check} ref={panel} tabIndex={-1} role="group" aria-labelledby="price-withdraw">
      <p className={styles.checkLine} id="price-withdraw">
        {copy.withdraw.question(longDate(withdrawing.price.valid_from))}
      </p>
      <div className={styles.actions}>
        <button className={styles.save} type="button" disabled={busy} onClick={onSend}>
          {busy ? copy.withdraw.taking : copy.withdraw.confirm}
        </button>
        <button className={styles.quiet} type="button" disabled={busy} onClick={onKeep}>
          {copy.withdraw.keep}
        </button>
      </div>
    </div>
  );
}

export function Prices() {
  const [loaded, retry] = useLoad(api.prices);
  /** The book after a price is set or taken back, so the table follows without reading it again. */
  const [book, setBook] = useState<readonly Price[] | null>(null);
  const [withdrawing, setWithdrawing] = useState<Withdrawing | null>(null);

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} />;

  const prices = book ?? loaded.value.prices;
  const today = loaded.value.today;

  const withdraw = async (price: Price) => {
    setWithdrawing({ step: "sending", price });
    const answer = await api.withdrawPrice({ item: price.item, tier: price.tier, valid_from: price.valid_from });
    if (!answer.ok) {
      setWithdrawing({ step: "failed", code: answer.code, fields: answer.fields });
      return;
    }
    setBook(answer.body.prices);
    setWithdrawing({ step: "done" });
  };

  return (
    <section className={styles.panel} aria-labelledby="prices">
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle} id="prices">
          {copy.title}
        </h2>
      </div>
      <p className={styles.note}>{copy.note}</p>
      <Table className={styles.table}>
        <thead>
          <tr>
            {copy.columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {prices.map((price) => {
            const state = stateOf(price, today);
            return (
              <tr key={`${price.item}/${price.tier}/${price.valid_from}`} className={styles[state]}>
                <th scope="row" className={styles.rowHead}>
                  {itemName(price.item)}
                </th>
                <td>{price.tier}</td>
                <td className={styles.figure}>{rupees(price.amount_ex_gst)}</td>
                <td className={styles.figure}>{copy.percent(price.gst_percent)}</td>
                <td className={styles.figure}>{longDate(price.valid_from)}</td>
                <td className={styles.state}>
                  {copy[state]}
                  {state === "scheduled" && (
                    <button
                      className={styles.inline}
                      type="button"
                      aria-label={copy.withdraw.label(itemName(price.item), longDate(price.valid_from))}
                      disabled={withdrawing?.step === "sending"}
                      onClick={() => {
                        setWithdrawing({ step: "asking", price });
                      }}
                    >
                      {copy.withdraw.button}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      {(withdrawing?.step === "asking" || withdrawing?.step === "sending") && (
        <Withdraw
          key={`${withdrawing.price.item}/${withdrawing.price.tier}/${withdrawing.price.valid_from}`}
          withdrawing={withdrawing}
          onSend={() => void withdraw(withdrawing.price)}
          onKeep={() => {
            setWithdrawing(null);
          }}
        />
      )}
      {withdrawing?.step === "done" && (
        <p className={styles.saved} role="status">
          {copy.withdraw.done}
        </p>
      )}
      {withdrawing?.step === "failed" && (
        <p className={styles.error} role="alert">
          {refusalOf({ ...copy.errors, ...copy.withdrawErrors }, withdrawing)}
        </p>
      )}
      <Form
        prices={prices}
        today={today}
        maxAmount={loaded.value.max_amount_ex_gst}
        maxGst={loaded.value.max_gst_percent}
        onSet={setBook}
      />
    </section>
  );
}
