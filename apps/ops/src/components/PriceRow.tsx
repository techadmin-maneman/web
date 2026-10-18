// A price on a line of its own, changed where it reads (@maneman/ui/EditableRow): the price in force, and beneath it
// each still to come with its day and a way to withdraw it. A new price asks its day in the same row, tomorrow to begin with, so
// none starts today by accident, and its boxes open on the price in force, its GST included, so no change of rate
// slips through unseen (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).

import { TextButton } from "@maneman/ui/TextLink";
import { DateInput, NumberInput } from "@maneman/ui/Field";
import { EditableRow } from "@maneman/ui/EditableRow";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { addDays, shortDate } from "@maneman/web-kit/dates";
import { paiseFromRupees, rupees, rupeesTyped } from "@maneman/web-kit/money";
import { errorText } from "@maneman/web-kit/refusal";
import type { Price } from "../api.ts";
import { EDITING } from "../content/common.ts";
import { packagesCopy } from "../content/packages.ts";
import { pricesApi } from "../prices/index.ts";
import styles from "./price-row.module.css";

const copy = packagesCopy.price;
const errors = packagesCopy.errors;

/** "Rs. 2,200", with its GST where it has one. */
export const priceText = (price: { readonly amount_ex_gst: number; readonly gst_percent: number }): string =>
  copy.gstOf(rupees(price.amount_ex_gst), price.gst_percent);

interface Typed {
  readonly rupees: string;
  readonly gst: string;
  readonly from: string;
}

interface PriceRowProps {
  readonly label: string;
  readonly item: Price["item"];
  readonly tier: string;
  /** Every price it has had and is to have, newest first. */
  readonly prices: readonly Price[];
  readonly today: string;
  readonly mayChange: boolean;
  /** Reads the page again once a price is set or withdrawn. */
  readonly onSaved: () => Promise<void>;
  readonly unpriced: string;
}

export function PriceRow(props: PriceRowProps) {
  return (
    <>
      <PriceEditor {...props} />
      {props.mayChange && (
        <PricesToCome
          prices={props.prices}
          today={props.today}
          item={props.item}
          tier={props.tier}
          onSaved={props.onSaved}
        />
      )}
    </>
  );
}

/** The price in force, and, for a person who may only look, each still to come. */
function PriceEditor(props: PriceRowProps) {
  const { prices, today } = props;
  const inForce = prices.find((price) => price.in_force);
  const toCome = prices.filter((price) => price.valid_from > today).reverse();
  const tomorrow = addDays(today, 1);
  const startFrom = toCome.at(-1) ?? inForce;

  const save = async (typed: Typed): Promise<string | null> => {
    const answer = await pricesApi.setPrice({
      item: props.item,
      tier: props.tier,
      amount_ex_gst: paiseFromRupees(typed.rupees),
      gst_percent: Number(typed.gst),
      valid_from: typed.from,
    });
    if (!answer.ok) return errorText(errors, answer);
    await props.onSaved();
    return null;
  };

  return (
    <EditableRow<Typed>
      label={props.label}
      words={EDITING}
      mayChange={props.mayChange}
      value={
        <span className={styles.prices}>
          <span>{inForce === undefined ? props.unpriced : priceText(inForce)}</span>
          {!props.mayChange &&
            toCome.map((price) => (
              <span key={price.valid_from} className={styles.toCome}>
                {copy.upcoming(priceText(price), shortDate(price.valid_from))}
              </span>
            ))}
        </span>
      }
      start={() => ({
        rupees: startFrom === undefined ? "" : rupeesTyped(startFrom.amount_ex_gst),
        gst: startFrom === undefined ? "0" : String(startFrom.gst_percent),
        from: tomorrow,
      })}
      save={save}
    >
      {(control, typed, type) => (
        <>
          <NumberInput
            {...control}
            aria-label={copy.amount}
            width="amount"
            inputMode="numeric"
            value={typed.rupees}
            onChange={(event) => {
              type({ ...typed, rupees: event.target.value });
            }}
          />
          <NumberInput
            aria-label={copy.gst}
            width="figure"
            inputMode="numeric"
            value={typed.gst}
            onChange={(event) => {
              type({ ...typed, gst: event.target.value });
            }}
          />
          <span className={styles.from}>{copy.from}</span>
          <DateInput
            aria-label={copy.from}
            min={tomorrow}
            value={typed.from}
            onChange={(event) => {
              type({ ...typed, from: event.target.value });
            }}
          />
        </>
      )}
    </EditableRow>
  );
}

/** Each price still to come, a way to withdraw it beside it, for a person who may change prices. */
function PricesToCome(props: {
  readonly prices: readonly Price[];
  readonly today: string;
  readonly item: Price["item"];
  readonly tier: string;
  readonly onSaved: () => Promise<void>;
}) {
  const [busy, once] = useOneAtATime();
  const toCome = props.prices.filter((price) => price.valid_from > props.today).reverse();
  if (toCome.length === 0) return null;
  return (
    <ul className={styles.list}>
      {toCome.map((price) => (
        <li key={price.valid_from} className={styles.line}>
          <span>{copy.upcoming(priceText(price), shortDate(price.valid_from))}</span>
          <TextButton
            compact
            busy={busy}
            aria-label={copy.takeBack(shortDate(price.valid_from))}
            onClick={() =>
              void once(async () => {
                const answer = await pricesApi.withdrawPrice({
                  item: props.item,
                  tier: props.tier,
                  valid_from: price.valid_from,
                });
                if (answer.ok) await props.onSaved();
              })
            }
          >
            {copy.withdraw}
          </TextButton>
        </li>
      ))}
    </ul>
  );
}
