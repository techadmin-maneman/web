// The price book (docs/decisions/0060-ops-editable-inputs.md). Every price the
// app charges is a row here, and a change is a new row from the day it applies,
// so an invoice already issued keeps the figure it was issued under.
//
// The table therefore shows all three states at once -- past, in force, still
// to come -- because a price set for next month is a decision somebody has to
// be able to see and correct before it lands.

import { longDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { api, type Price } from "../api.ts";
import { settings } from "../content.ts";
import { useLoad } from "../lib/useLoad.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "./settings.module.css";

const copy = settings.prices;

type Saving = { readonly step: "editing" | "saving" | "saved" } | { readonly step: "failed"; readonly code: string };

/** Which of the three a row is: the one that applies today, one still to come, or one that is spent. */
function state(price: Price, today: string): string {
  if (price.in_force) return copy.inForce;
  return price.valid_from > today ? copy.scheduled : copy.spent;
}

/** An item's name as ops read it: the API's key, with its underscores opened up. */
const itemName = (item: string) => item.replace(/_/g, " ");

function Form({
  items,
  tiers,
  today,
  maxAmount,
  maxGst,
  onSet,
}: {
  items: readonly string[];
  tiers: readonly string[];
  today: string;
  maxAmount: number;
  maxGst: number;
  onSet: (prices: readonly Price[]) => void;
}) {
  const [item, setItem] = useState(items[0] ?? "");
  const [tier, setTier] = useState(tiers[0] ?? "standard");
  const [rupees, setRupees] = useState("");
  const [gst, setGst] = useState("0");
  const [from, setFrom] = useState(today);
  const [saving, setSaving] = useState<Saving>({ step: "editing" });

  const form = copy.form;
  const busy = saving.step === "saving";
  const ready = item !== "" && tier !== "" && rupees.trim() !== "" && gst.trim() !== "" && from !== "";

  const send = async () => {
    setSaving({ step: "saving" });
    const answer = await api.setPrice({
      item,
      tier,
      // Rupees on the screen, paise in the book: the API and the database count in paise.
      amount_ex_gst: Math.round(Number(rupees) * 100),
      gst_percent: Number(gst),
      valid_from: from,
    });
    if (!answer.ok) {
      // invalid_request names the field it refused, so the line under the form is about that field.
      setSaving({ step: "failed", code: answer.code });
      return;
    }
    onSet(answer.body.prices);
    setSaving({ step: "saved" });
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
              setItem(event.target.value);
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
          {/* A list, not a picker: a new tier is how a new kind of base is priced. */}
          <input
            className={styles.text}
            id="price-tier"
            type="text"
            list="price-tiers"
            maxLength={32}
            value={tier}
            onChange={(event) => {
              setTier(event.target.value);
            }}
          />
          <datalist id="price-tiers">
            {tiers.map((each) => (
              <option key={each} value={each} />
            ))}
          </datalist>
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="price-amount">
            {form.amount}
          </label>
          <input
            className={styles.number}
            id="price-amount"
            type="number"
            inputMode="numeric"
            step={1}
            min={0}
            max={maxAmount / 100}
            value={rupees}
            aria-describedby="price-amount-hint"
            onChange={(event) => {
              setRupees(event.target.value);
            }}
          />
          <p className={styles.hint} id="price-amount-hint">
            {form.amountHint(maxAmount)}
          </p>
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="price-gst">
            {form.gst}
          </label>
          <input
            className={styles.number}
            id="price-gst"
            type="number"
            inputMode="numeric"
            step={1}
            min={0}
            max={maxGst}
            value={gst}
            aria-describedby="price-gst-hint"
            onChange={(event) => {
              setGst(event.target.value);
            }}
          />
          <p className={styles.hint} id="price-gst-hint">
            {form.gstHint(maxGst)}
          </p>
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="price-from">
            {form.from}
          </label>
          <input
            className={styles.text}
            id="price-from"
            type="date"
            min={today}
            value={from}
            aria-describedby="price-from-hint"
            onChange={(event) => {
              setFrom(event.target.value);
            }}
          />
          <p className={styles.hint} id="price-from-hint">
            {form.fromHint}
          </p>
        </div>
      </div>
      <div className={styles.actions}>
        <button className={styles.save} type="button" disabled={busy || !ready} onClick={() => void send()}>
          {busy ? form.saving : form.save}
        </button>
      </div>
      {saving.step === "saved" && (
        <p className={styles.saved} role="status">
          {form.saved}
        </p>
      )}
      {saving.step === "failed" && (
        <p className={styles.error} role="alert">
          {copy.errors[saving.code] ?? copy.errors.unknown}
        </p>
      )}
    </fieldset>
  );
}

export function Prices() {
  const [loaded, retry] = useLoad(api.prices);
  /** The book after a price is set, so the table follows without reading it again. */
  const [book, setBook] = useState<readonly Price[] | null>(null);

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} />;

  const prices = book ?? loaded.value.prices;
  const today = loaded.value.today;
  const items = [...new Set(prices.map((price) => price.item))];
  const tiers = [...new Set(prices.map((price) => price.tier))];

  return (
    <section className={styles.panel} aria-labelledby="prices">
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle} id="prices">
          {copy.title}
        </h2>
      </div>
      <p className={styles.note}>{copy.note}</p>
      <table className={styles.table}>
        <thead>
          <tr>
            {copy.columns.map((column) => (
              <th key={column} scope="col" className={styles.column}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {prices.map((price) => (
            <tr key={`${price.item}/${price.tier}/${price.valid_from}`} className={price.in_force ? styles.live : ""}>
              <th scope="row" className={styles.rowHead}>
                {itemName(price.item)}
              </th>
              <td>{price.tier}</td>
              <td className={styles.figure}>{copy.rupees(price.amount_ex_gst)}</td>
              <td className={styles.figure}>{copy.percent(price.gst_percent)}</td>
              <td>{longDate(price.valid_from)}</td>
              <td className={styles.state}>{state(price, today)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Form
        items={items}
        tiers={tiers}
        today={today}
        maxAmount={loaded.value.max_amount_ex_gst}
        maxGst={loaded.value.max_gst_percent}
        onSet={setBook}
      />
    </section>
  );
}
