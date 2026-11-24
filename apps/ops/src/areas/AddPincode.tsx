// Adding a pincode the service area does not hold: its number, what messages call its area, and its city, one of
// ours. It goes in unserved, so adding one messages nobody; marking it live is the launch panel's.

import { WAITING_FOR } from "../content/common.ts";
import { describedBy, Missing } from "@maneman/ui/Missing";
import { ACTION_ICONS } from "@maneman/brand/action-icons";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { CancelButton } from "@maneman/ui/CancelButton";
import { Field, Select, TextInput } from "@maneman/ui/Field";
import { errorText } from "@maneman/web-kit/refusal";
import { Button } from "@maneman/ui/Button";
import { type ReactNode, useState } from "react";
import { type ServedPincode } from "../api.ts";
import { areas } from "../content.ts";
import shared from "./areas.module.css";
import styles from "./add-pincode.module.css";
import form from "@maneman/ui/forms.module.css";
import { AREA_NAME, PINCODE } from "./rules.ts";
import { Refusal } from "@maneman/ui/Refusal";
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

/** No city to add a pincode to yet: the way to add one is in Cities. */
function NoCity({ cancel }: { cancel: ReactNode }) {
  return (
    <div>
      <p className={shared.note}>{copy.noCity}</p>
      {cancel}
    </div>
  );
}

/** The city it goes in, one of ours. */
function CityChoice(props: { cities: readonly string[]; city: string; onCity: (city: string) => void }) {
  return (
    <Field label={copy.city}>
      {(control) => (
        <Select
          {...control}
          className={styles.box}
          value={props.city}
          onChange={(event) => {
            props.onCity(event.target.value);
          }}
        >
          <option value="">{copy.chooseCity}</option>
          {props.cities.map((each) => (
            <option key={each} value={each}>
              {each}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

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

  const cancel = onCancel === undefined ? null : <CancelButton disabled={busy} onClick={onCancel} />;

  if (cities.length === 0) return <NoCity cancel={cancel} />;

  return (
    <div>
      <div className={form.fields}>
        {pincode === null && (
          <Field label={copy.pincode} error={refusals.pincode} announce>
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
        <Field label={copy.area} error={refusals.area} announce>
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
        <CityChoice cities={cities} city={city} onCity={setCity} />
      </div>
      <div className={shared.actions}>
        <Button
          icon={ACTION_ICONS.plus}
          variant="primary"
          size="small"
          disabled={!ready}
          aria-describedby={describedBy("pincode-waits", !ready && !busy)}
          onClick={() => void add()}
        >
          {busy ? copy.adding : copy.add}
        </Button>
        {cancel}
      </div>
      <Missing id="pincode-waits" what={!ready && !busy ? WAITING_FOR.pincode : null} />
      {code !== null && <Refusal className={shared.error} said={errorText(copy.errors, { code })} />}
    </div>
  );
}
