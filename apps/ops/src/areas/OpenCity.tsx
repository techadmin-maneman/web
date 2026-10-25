// Opening a city from India Post's pincodes (src/routes/ops/pincode-directory.ts): a state, up to ten of its districts,
// then their pincodes, each one not held already ticked, added unserved to one of our cities. Serving them is the
// table's above; a pincode the directory does not list is still added by hand beneath.

import { Button } from "@maneman/ui/Button";
import { Checkbox, ChoiceGroup, Field, Fieldset, Select } from "@maneman/ui/Field";
import { Table } from "@maneman/ui/Table";
import { Toast } from "@maneman/ui/Toast";
import { useLoad } from "@maneman/ui/useLoad";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { errorText } from "@maneman/web-kit/refusal";
import { useState } from "react";
import type { DirectoryDistrict, DirectoryPincode, ServedPincode } from "../api.ts";
import { areas } from "../content.ts";
import form from "../components/forms.module.css";
import { Refusal } from "../components/Refusal.tsx";
import shared from "./areas.module.css";
import { areasApi } from "./areas-api.ts";
import type { CsvRow } from "./csv.ts";
import { AREA_NAME } from "./rules.ts";
import { readUpload, type Upload } from "./served-draft.ts";

const copy = areas.directory;
const MOST_DISTRICTS = 10;
/** The API adds this many a call, so each stays one short batch; ten districts can hold four times as many. */
const PER_CALL = 300;

/** A name the directory spells in capitals, as ops read it: "GAUTAM BUDDHA NAGAR" → "Gautam Buddha Nagar". */
const titled = (name: string) => name.toLowerCase().replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());

const toggled = (set: ReadonlySet<string>, values: readonly string[], on: boolean) => {
  const next = new Set(set);
  for (const each of values) {
    if (on) next.add(each);
    else next.delete(each);
  }
  return next;
};

/** A state and up to ten of its districts, whose pincodes `onShown` is given. */
function ChooseDistricts({ onShown }: { onShown: (pincodes: readonly DirectoryPincode[]) => void }) {
  const [states] = useLoad(areasApi.states);
  const [state, setState] = useState("");
  const [districts, setDistricts] = useState<readonly DirectoryDistrict[] | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [busy, once] = useOneAtATime();
  const [code, setCode] = useState<string | null>(null);

  const chooseState = (next: string) =>
    once(async () => {
      setState(next);
      setDistricts(null);
      setPicked(new Set());
      setCode(null);
      if (next === "") return;
      const answer = await areasApi.districts(next);
      if (answer.ok) setDistricts(answer.body.districts);
      else setCode(answer.code);
    });

  const show = () =>
    once(async () => {
      setCode(null);
      const answer = await areasApi.directory(state, [...picked]);
      if (answer.ok) onShown(answer.body.pincodes);
      else setCode(answer.code);
    });

  const tooMany = picked.size > MOST_DISTRICTS;
  return (
    <>
      <Field label={copy.state} className={shared.field}>
        {(control) => (
          <Select {...control} value={state} onChange={(event) => void chooseState(event.target.value)}>
            <option value="">{copy.chooseState}</option>
            {(states.state === "loaded" ? states.value.states : []).map((each) => (
              <option key={each} value={each}>
                {titled(each)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {districts !== null && (
        <ChoiceGroup legend={copy.districts} hint={copy.districtsHint} inline>
          {districts.map((each) => (
            <Checkbox
              key={each.district}
              label={copy.district(titled(each.district), each.pincodes, each.held)}
              checked={picked.has(each.district)}
              onChange={(event) => {
                setPicked(toggled(picked, [each.district], event.target.checked));
              }}
            />
          ))}
        </ChoiceGroup>
      )}
      {districts !== null && (
        <div className={shared.actions}>
          <Button
            variant="outline"
            size="small"
            disabled={picked.size === 0 || tooMany || busy}
            onClick={() => void show()}
          >
            {busy ? copy.showing : copy.show}
          </Button>
          {tooMany && <p className={shared.note}>{copy.tooMany}</p>}
        </div>
      )}
      {code !== null && <Refusal className={shared.error} said={errorText(copy.errors, { code })} />}
    </>
  );
}

/** The pincodes shown, a box each; one the service area holds already says where, and cannot be ticked. */
function PincodeTicks(props: {
  pincodes: readonly DirectoryPincode[];
  ticked: ReadonlySet<string>;
  onTicked: (next: ReadonlySet<string>) => void;
}) {
  const { pincodes, ticked, onTicked } = props;
  const free = pincodes.filter((each) => each.held === null).map((each) => each.pincode);
  return (
    <Table>
      <thead>
        <tr>
          <th scope="col">
            <Checkbox
              aria-label={copy.all}
              checked={free.length > 0 && free.every((each) => ticked.has(each))}
              onChange={(event) => {
                onTicked(toggled(ticked, free, event.target.checked));
              }}
            />
          </th>
          {copy.columns.map((each) => (
            <th key={each} scope="col">
              {each}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {pincodes.map((each) => (
          <tr key={each.pincode}>
            <td>
              <Checkbox
                aria-label={copy.tick(each.pincode, each.area)}
                disabled={each.held !== null}
                checked={ticked.has(each.pincode)}
                onChange={(event) => {
                  onTicked(toggled(ticked, [each.pincode], event.target.checked));
                }}
              />
            </td>
            <th scope="row">{each.pincode}</th>
            <td>{each.area}</td>
            <td>{titled(each.district)}</td>
            <td>{each.offices.length}</td>
            <td>{each.held === null ? copy.notHeld : copy.held(each.held.city)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** Sends pincodes to a city, a run at a time; a run refused stops the rest, and keeps those added. */
async function addInRuns(city: string, pincodes: readonly { pincode: string; area?: string }[]) {
  const added: ServedPincode[] = [];
  const unlisted: string[] = [];
  let held = 0;
  for (let at = 0; at < pincodes.length; at += PER_CALL) {
    const answer = await areasApi.addFromDirectory({ city, pincodes: pincodes.slice(at, at + PER_CALL) });
    if (!answer.ok) return { added, held, unlisted, code: answer.code };
    added.push(...answer.body.added);
    unlisted.push(...answer.body.unlisted);
    held += answer.body.held.length;
  }
  return { added, held, unlisted, code: null };
}

/**
 * A file's pincodes we do not hold, added city by city, then the file read again against the table that holds them, so
 * serving them is the file's next step. An area takes the file's name where the API would take it, else India Post's.
 */
export async function addFromFile(
  pincodes: readonly ServedPincode[],
  lines: readonly CsvRow[],
  adds: readonly CsvRow[],
): Promise<{ readonly added: readonly ServedPincode[]; readonly upload: Upload }> {
  const added: ServedPincode[] = [];
  const unlisted: string[] = [];
  for (const city of new Set(adds.map((each) => each.city))) {
    const run = adds
      .filter((each) => each.city === city)
      .map((each) =>
        AREA_NAME.test(each.area) ? { pincode: each.pincode, area: each.area } : { pincode: each.pincode },
      );
    const result = await addInRuns(city, run);
    added.push(...result.added);
    unlisted.push(...result.unlisted);
    if (result.code !== null) {
      return { added, upload: { step: "failed", says: errorText(copy.errors, { code: result.code }) } };
    }
  }
  const read = readUpload([...pincodes, ...added], lines);
  return { added, upload: { ...read, adds: [], said: areas.served.upload.added(added.length, unlisted) } };
}

/** Adds the pincodes ticked to one of our cities, unserved; `onAdded` puts them in the table above. */
export function OpenCity(props: { cities: readonly string[]; onAdded: (added: readonly ServedPincode[]) => void }) {
  const [pincodes, setPincodes] = useState<readonly DirectoryPincode[] | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [city, setCity] = useState("");
  const [busy, once] = useOneAtATime();
  const [code, setCode] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  const shown = (next: readonly DirectoryPincode[]) => {
    setPincodes(next);
    setTicked(new Set(next.filter((each) => each.held === null).map((each) => each.pincode)));
    setSaid(null);
  };

  const add = () =>
    once(async () => {
      setCode(null);
      const chosen = (pincodes ?? []).filter((each) => ticked.has(each.pincode));
      const result = await addInRuns(
        city,
        chosen.map((each) => ({ pincode: each.pincode, area: each.area })),
      );
      if (result.added.length > 0) props.onAdded(result.added);
      if (result.code !== null) setCode(result.code);
      else setPincodes(null);
      setSaid(copy.added(result.added.length, city, result.held));
    });

  return (
    <Fieldset className={form.group} legend={copy.title} legendLook="title">
      <ChooseDistricts onShown={shown} />
      {pincodes !== null && <PincodeTicks pincodes={pincodes} ticked={ticked} onTicked={setTicked} />}
      {pincodes !== null && (
        <Field label={copy.city} className={shared.field}>
          {(control) => (
            <Select
              {...control}
              value={city}
              onChange={(event) => {
                setCity(event.target.value);
              }}
            >
              <option value="">{areas.add.chooseCity}</option>
              {props.cities.map((each) => (
                <option key={each} value={each}>
                  {each}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      {pincodes !== null && (
        <div className={shared.actions}>
          <Button
            variant="primary"
            size="small"
            disabled={city === "" || ticked.size === 0 || busy}
            onClick={() => void add()}
          >
            {busy ? copy.adding : copy.add(ticked.size)}
          </Button>
        </div>
      )}
      {said !== null && <Toast>{said}</Toast>}
      {code !== null && <Refusal className={shared.error} said={errorText(copy.errors, { code })} />}
    </Fieldset>
  );
}
