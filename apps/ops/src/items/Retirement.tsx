// Retiring a consumable from a day, or offering one retired again (docs/decisions/0087-consumables-and-stock.md), from
// its record's foot. Retiring asks its day and says what that does before anything is sent: the technician app stops
// offering it from that day; nothing already recorded moves, and neither does its stock.

import { Button } from "@maneman/ui/Button";
import { DateInput, Field } from "@maneman/ui/Field";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { longDate } from "@maneman/web-kit/dates";
import { errorText } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { type Consumable, type Consumables } from "../api.ts";
import { FormActions } from "../components/FormActions.tsx";
import { Refusal } from "../components/Refusal.tsx";
import { settings } from "../content/settings.ts";
import { itemsApi } from "./items-api.ts";
import styles from "./consumables.module.css";

const copy = settings.consumables;
const words = copy.retiring;

interface Props {
  readonly consumable: Consumable;
  readonly onSaved: (consumables: Consumables) => void;
}

/** Offered, offered until a day, or retired from one. */
export function stateWords(consumable: Consumable): string {
  if (consumable.retired_from === null) return copy.states.offered;
  const from = longDate(consumable.retired_from);
  return consumable.offered ? copy.states.retiring(from) : copy.states.retired(from);
}

/** A retired consumable offered again, on one press. */
export function Restoring({ consumable, onSaved }: Props) {
  const [busy, once] = useOneAtATime();
  const [refused, setRefused] = useState<string | null>(null);
  const restore = () =>
    once(async () => {
      setRefused(null);
      const answer = await itemsApi.restoreConsumable(consumable.code);
      if (!answer.ok) {
        setRefused(errorText(copy.errors, answer));
        return;
      }
      onSaved(answer.body);
    });
  return (
    <>
      <Button
        variant="outline"
        size="small"
        narrow
        busy={busy}
        aria-label={copy.restoreLabel(consumable.name)}
        onClick={() => void restore()}
      >
        {copy.restore}
      </Button>
      {refused !== null && <Refusal said={refused} />}
    </>
  );
}

/** An offered consumable retired from a day, which the question names before anything is sent. */
export function Retiring({ consumable, today, onSaved }: Props & { readonly today: string }) {
  const [asking, setAsking] = useState(false);
  const [from, setFrom] = useState(today);
  const [busy, once] = useOneAtATime();
  const [refused, setRefused] = useState<string | null>(null);
  const retire = () =>
    once(async () => {
      setRefused(null);
      const answer = await itemsApi.retireConsumable(consumable.code, from);
      if (!answer.ok) {
        setRefused(errorText(copy.errors, answer));
        return;
      }
      setAsking(false);
      onSaved(answer.body);
    });
  if (!asking) {
    return (
      <Button
        variant="outline"
        size="small"
        narrow
        aria-label={copy.retireLabel(consumable.name)}
        onClick={() => {
          setAsking(true);
        }}
      >
        {copy.retire}
      </Button>
    );
  }
  return (
    <form
      noValidate
      className={styles.asking}
      aria-label={copy.retireLabel(consumable.name)}
      onSubmit={(event) => {
        event.preventDefault();
        void retire();
      }}
    >
      <Field label={words.from}>
        {(control) => (
          <DateInput
            {...control}
            width="date"
            min={today}
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
            }}
          />
        )}
      </Field>
      <p className={styles.question}>{words.question(consumable.name, from === "" ? "" : longDate(from))}</p>
      <FormActions>
        <Button variant="danger" size="small" type="submit" busy={busy}>
          {copy.retire}
        </Button>
        <Button
          variant="outline"
          size="small"
          narrow
          onClick={() => {
            setAsking(false);
          }}
        >
          {copy.form.cancel}
        </Button>
      </FormActions>
      {refused !== null && <Refusal said={refused} />}
    </form>
  );
}
