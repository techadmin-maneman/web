// Growth · Spend (docs/decisions/0150-spend.md): a month's offline spend, for a city or national, by channel, which the
// nightly reporting copy counts beside the ad accounts' own. An entry is added whole, and taken off rather than changed.

import { Button } from "@maneman/ui/Button";
import { Field, Select, TextInput } from "@maneman/ui/Field";
import { Panel } from "@maneman/ui/Panel";
import { Table } from "@maneman/ui/Table";
import { classes } from "@maneman/ui/classes";
import { useLoad } from "@maneman/ui/useLoad";
import { fullMonth } from "@maneman/web-kit/dates";
import { paiseFromRupees, rupees } from "@maneman/web-kit/money";
import type { Failure } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { Shell } from "../components/Shell.tsx";
import { spend as copy } from "../content/spend.ts";
import { useAccess } from "../lib/access.ts";
import { SECTION_NAMES } from "../route.ts";
import { Refused } from "../settings/index.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { spendApi, type SpendChannel, type SpendEntry, type SpendList } from "./spend-api.ts";
import styles from "../components/forms.module.css";

/** Each month from the first the page takes to this one, the latest first. */
function monthsOf(list: SpendList): string[] {
  const months: string[] = [];
  for (let month = list.this_month; month >= list.first_month;) {
    months.push(month);
    const [year = 0, number = 1] = month.split("-").map(Number);
    month = number === 1 ? `${String(year - 1)}-12` : `${String(year)}-${String(number - 1).padStart(2, "0")}`;
  }
  return months;
}

/** Whole rupees, one or more, as typed. */
const isRupees = (typed: string): boolean => /^\d+$/.test(typed.trim()) && Number(typed) >= 1;

function Choice(props: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  return (
    <Field label={props.label}>
      {(control) => (
        <Select
          {...control}
          className={styles.choiceBox}
          value={props.value}
          onChange={(event) => {
            props.onChange(event.target.value);
          }}
        >
          {props.options.map(([value, words]) => (
            <option key={value} value={value}>
              {words}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

function Typed(props: { label: string; value: string; maxLength: number; onChange: (value: string) => void }) {
  return (
    <Field label={props.label}>
      {(control) => (
        <TextInput
          {...control}
          maxLength={props.maxLength}
          value={props.value}
          onChange={(event) => {
            props.onChange(event.target.value);
          }}
        />
      )}
    </Field>
  );
}

function SpendForm({ list, onAdded }: { list: SpendList; onAdded: (entry: SpendEntry) => void }) {
  const [month, setMonth] = useState(list.this_month);
  const [city, setCity] = useState("");
  const [channel, setChannel] = useState<SpendChannel>(list.channels[0] ?? "partner");
  const [campaign, setCampaign] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const add = async () => {
    setBusy(true);
    setFailure(null);
    const answer = await spendApi.add({
      month,
      city: city === "" ? null : city,
      channel,
      amount: paiseFromRupees(amount),
      ...(campaign.trim() === "" ? {} : { campaign: campaign.trim() }),
      ...(note.trim() === "" ? {} : { note: note.trim() }),
    });
    setBusy(false);
    if (!answer.ok) {
      setFailure({ code: answer.code, fields: answer.fields });
      return;
    }
    setAmount("");
    setCampaign("");
    setNote("");
    onAdded(answer.body);
  };
  const channelOf = (value: string) => list.channels.find((each) => each === value);
  return (
    <div className={styles.group}>
      <Choice
        label={copy.month}
        value={month}
        options={monthsOf(list).map((each) => [each, fullMonth(each)])}
        onChange={setMonth}
      />
      <Choice
        label={copy.city}
        value={city}
        options={[["", copy.national], ...list.cities.map((each) => [each, each] as const)]}
        onChange={setCity}
      />
      <Choice
        label={copy.channel}
        value={channel}
        options={list.channels.map((each) => [each, copy.channels[each]])}
        onChange={(value) => {
          setChannel(channelOf(value) ?? channel);
        }}
      />
      <Typed label={copy.campaign} value={campaign} maxLength={120} onChange={setCampaign} />
      <p className={styles.note}>{copy.campaignNote}</p>
      <Typed label={copy.amount} value={amount} maxLength={12} onChange={setAmount} />
      <Typed label={copy.note} value={note} maxLength={200} onChange={setNote} />
      <Button variant="outline" size="small" disabled={busy || !isRupees(amount)} onClick={() => void add()}>
        {busy ? copy.adding : copy.add}
      </Button>
      <Refused failed={failure} errors={copy.errors} />
    </div>
  );
}

function SpendTable(props: { entries: readonly SpendEntry[]; mayRemove: boolean; onRemove: (id: string) => void }) {
  if (props.entries.length === 0) return <p className={styles.note}>{copy.none}</p>;
  return (
    <Table className={classes(styles.table)}>
      <thead>
        <tr>
          {Object.values(copy.columns).map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
          {props.mayRemove && <th scope="col" />}
        </tr>
      </thead>
      <tbody>
        {props.entries.map((entry) => (
          <tr key={entry.id}>
            <td>{fullMonth(entry.month)}</td>
            <td>{entry.city ?? copy.national}</td>
            <td>
              {entry.campaign === null
                ? copy.channels[entry.channel]
                : `${copy.channels[entry.channel]} · ${entry.campaign}`}
            </td>
            <td>{rupees(entry.amount)}</td>
            <td>{entry.note ?? ""}</td>
            <td>{entry.entered_by}</td>
            {props.mayRemove && (
              <td>
                <button
                  className={styles.inline}
                  type="button"
                  aria-label={copy.removeLabel(
                    fullMonth(entry.month),
                    entry.city ?? copy.national,
                    rupees(entry.amount),
                  )}
                  onClick={() => {
                    props.onRemove(entry.id);
                  }}
                >
                  {copy.remove}
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function Spend() {
  const [loaded, retry] = useLoad(spendApi.list);
  const [entries, setEntries] = useState<SpendEntry[] | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const access = useAccess();
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const shown = entries ?? loaded.value.entries;
  const remove = async (id: string) => {
    setFailure(null);
    const answer = await spendApi.remove(id);
    if (answer.ok) setEntries(shown.filter((entry) => entry.id !== id));
    else setFailure({ code: answer.code, fields: answer.fields });
  };
  return (
    <>
      {access.mayCall("POST /api/spend") && (
        <SpendForm
          list={loaded.value}
          onAdded={(entry) => {
            setEntries([entry, ...shown].sort((one, other) => other.month.localeCompare(one.month)));
          }}
        />
      )}
      <Refused failed={failure} errors={copy.errors} />
      <SpendTable
        entries={shown}
        mayRemove={access.mayCall("POST /api/spend/{id}/remove")}
        onRemove={(id) => void remove(id)}
      />
    </>
  );
}

export function SpendScreen() {
  return (
    <Shell section="/spend" title={SECTION_NAMES.spend}>
      <div className={styles.screen}>
        <Panel titleId="spend" title={copy.title} className={styles.panel}>
          <p className={styles.note}>{copy.intro}</p>
          <Spend />
        </Panel>
      </div>
    </Shell>
  );
}
