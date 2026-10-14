// Adding a pincode the service area does not hold: its number, what messages call its area, and its city, one of
// ours. It goes in unserved, so adding one messages nobody; marking it live is the launch panel's.

import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { Field, Select, TextInput } from "@maneman/ui/Field";
import { errorText } from "@maneman/web-kit/refusal";
import { Button } from "@maneman/ui/Button";
import { useState } from "react";
import { type ServedPincode } from "../api.ts";
import { areas } from "../content.ts";
import styles from "./areas.module.css";
import { AREA_NAME, PINCODE } from "./rules.ts";
import { Refusal } from "../components/Refusal.tsx";
import { areasApi } from "./areas-api.ts";

const copy = areas.add;

interface Props {
  /** The pincode where it is chosen already; null for a box to type it in. */
  readonly pincode: string | null;
  /** The cities it may go in. */
  readonly cities: readonly string[];
  readonly onAdded: (added: ServedPincode) => void;
  /** A way out, where the form stands in a panel of its own. */
  readonly onCancel?: () => void;
}

/** Each box's refusal, said on the box before anything is sent; null where it holds what it should. */
const boxRefusals = (pincode: string, area: string) => ({
  pincode: pincode !== "" && !PINCODE.test(pincode) ? copy.badPincode : null,
  area: area !== "" && !AREA_NAME.test(area) ? copy.badName : null,
});

export function AddPincode({ pincode, cities, onAdded, onCancel }: Props) {
  const [typed, setTyped] = useState("");
  const [area, setArea] = useState("");
  const [city, setCity] = useState("");
  const [busy, once] = useOneAtATime();
  const [code, setCode] = useState<string | null>(null);

  const number = pincode ?? typed.trim();
  const name = area.trim();
  const refusals = boxRefusals(number, name);
  const ready = PINCODE.test(number) && AREA_NAME.test(name) && city !== "" && !busy;

  const add = () =>
    once(async () => {
      setCode(null);
      const answer = await areasApi.addPincode({ pincode: number, area: name, city });
      if (!answer.ok) {
        setCode(answer.code);
        return;
      }
      setTyped("");
      setArea("");
      setCity("");
      onAdded(answer.body);
    });

  const cancel =
    onCancel === undefined ? null : (
      <Button variant="outline" size="small" disabled={busy} onClick={onCancel}>
        {areas.launch.cancel}
      </Button>
    );

  if (cities.length === 0) {
    return (
      <div className={styles.addForm}>
        <p className={styles.note}>{copy.noCity}</p>
        {cancel}
      </div>
    );
  }

  return (
    <div className={styles.addForm}>
      {pincode === null && (
        <Field label={copy.pincode} className={styles.field} error={refusals.pincode} announce>
          {(control) => (
            <TextInput
              {...control}
              className={styles.box}
              inputMode="numeric"
              maxLength={6}
              value={typed}
              onChange={(event) => {
                setTyped(event.target.value);
              }}
            />
          )}
        </Field>
      )}
      <Field label={copy.area} className={styles.field} error={refusals.area} announce>
        {(control) => (
          <TextInput
            {...control}
            className={styles.box}
            maxLength={40}
            value={area}
            onChange={(event) => {
              setArea(event.target.value);
            }}
          />
        )}
      </Field>
      <Field label={copy.city} className={styles.field}>
        {(control) => (
          <Select
            {...control}
            className={styles.box}
            value={city}
            onChange={(event) => {
              setCity(event.target.value);
            }}
          >
            <option value="">{copy.chooseCity}</option>
            {cities.map((each) => (
              <option key={each} value={each}>
                {each}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className={styles.actions}>
        <Button variant="primary" size="small" disabled={!ready} onClick={() => void add()}>
          {busy ? copy.adding : copy.add}
        </Button>
        {cancel}
      </div>
      {code !== null && <Refusal className={styles.error} said={errorText(copy.errors, { code })} />}
    </div>
  );
}
