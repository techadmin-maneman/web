// A package's hair systems (docs/decisions/0211-packages.md): each its own stock code, made to a spec and sold at a
// price of its own. A row opens its record beneath the list, where its price and its cost change in place; one never
// stocked may be deleted, any other retired. A new one is added to the package with its spec and its cost.

import { Badge } from "@maneman/ui/Badge";
import { Button } from "@maneman/ui/Button";
import { EditableRow } from "@maneman/ui/EditableRow";
import { EmptyState } from "@maneman/ui/EmptyState";
import { Field, NumberInput, Select } from "@maneman/ui/Field";
import { Table } from "@maneman/ui/Table";
import { TextButton } from "@maneman/ui/TextLink";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { paiseFromRupees, rupees, rupeesTyped } from "@maneman/web-kit/money";
import { errorText } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { DeleteAction } from "../components/DeleteAction.tsx";
import { PriceRow, priceText } from "../components/PriceRow.tsx";
import { Refusal } from "../components/Refusal.tsx";
import { RowHead } from "../components/RowHead.tsx";
import { EDITING } from "../content/common.ts";
import { packagesCopy } from "../content/packages.ts";
import { itemsApi } from "../items/index.ts";
import { useAccess } from "../lib/access.ts";
import { packagesApi, type Package, type PackageHairSystem } from "./packages-api.ts";
import styles from "./packages.module.css";

const copy = packagesCopy.hairSystems;
const errors = packagesCopy.errors;

/** The suppliers' colour codes and densities, as the hair profile takes them. */
const COLOURS = ["1", "1B", "2", "3", "4", "5", "6", "7", "8"] as const;
const DENSITIES = [80, 100, 120, 140] as const;

const specOf = (piece: PackageHairSystem) => copy.spec(piece);

interface Draft {
  readonly width: string;
  readonly length: string;
  readonly colour: string;
  readonly grey: string;
  readonly density: string;
  readonly cost: string;
}

const BLANK: Draft = { width: "", length: "", colour: "1B", grey: "0", density: "100", cost: "" };

function Figure(props: { readonly label: string; readonly value: string; readonly onChange: (value: string) => void }) {
  return (
    <Field label={props.label} className={styles.addField}>
      {(control) => (
        <NumberInput
          {...control}
          width="figure"
          type="text"
          inputMode="decimal"
          maxLength={10}
          value={props.value}
          onChange={(event) => {
            props.onChange(event.target.value);
          }}
        />
      )}
    </Field>
  );
}

function Choice(props: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly (readonly [string, string])[];
  readonly onChange: (value: string) => void;
}) {
  return (
    <Field label={props.label} className={styles.addField}>
      {(control) => (
        <Select
          {...control}
          width="choice"
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

/** A new hair system in this package: its spec and what one costs us. */
function AddHairSystem(props: {
  readonly product: string;
  readonly onAdded: () => Promise<void>;
  readonly onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [refused, setRefused] = useState<string | null>(null);
  const [busy, once] = useOneAtATime();
  const edit = (field: keyof Draft) => (value: string) => {
    setDraft({ ...draft, [field]: value });
  };
  const add = () =>
    once(async () => {
      const answer = await packagesApi.addHairSystem({
        product: props.product,
        base_width_in: Number(draft.width),
        base_length_in: Number(draft.length),
        colour: COLOURS.find((each) => each === draft.colour) ?? "1B",
        grey_percent: Number(draft.grey),
        density_percent: DENSITIES.find((each) => String(each) === draft.density) ?? 100,
        unit_cost: paiseFromRupees(draft.cost),
      });
      if (!answer.ok) {
        setRefused(errorText(errors, answer));
        return;
      }
      await props.onAdded();
    });
  return (
    <form
      noValidate
      className={styles.addHairSystem}
      aria-label={copy.addTitle}
      onSubmit={(event) => {
        event.preventDefault();
        void add();
      }}
    >
      <div className={styles.addFields}>
        <Figure label={copy.width} value={draft.width} onChange={edit("width")} />
        <Figure label={copy.length} value={draft.length} onChange={edit("length")} />
        <Choice
          label={copy.colour}
          value={draft.colour}
          options={COLOURS.map((each) => [each, `#${each}`] as const)}
          onChange={edit("colour")}
        />
        <Figure label={copy.grey} value={draft.grey} onChange={edit("grey")} />
        <Choice
          label={copy.density}
          value={draft.density}
          options={DENSITIES.map((each) => [String(each), `${String(each)}%`] as const)}
          onChange={edit("density")}
        />
        <Figure label={copy.cost} value={draft.cost} onChange={edit("cost")} />
      </div>
      <div className={styles.addActions}>
        <Button variant="primary" size="small" type="submit" busy={busy}>
          {copy.create}
        </Button>
        <Button variant="quiet" size="small" narrow onClick={props.onCancel}>
          {packagesCopy.cancel}
        </Button>
      </div>
      {refused !== null && <Refusal said={refused} />}
    </form>
  );
}

/** What one costs us, changed where it reads. */
function Cost(props: { readonly piece: PackageHairSystem; readonly refresh: () => Promise<void> }) {
  const { piece } = props;
  return (
    <EditableRow<string>
      label={copy.columns.cost}
      words={EDITING}
      mayChange={useAccess().mayCall("POST /api/consumables/{code}")}
      value={rupees(piece.unit_cost)}
      start={() => rupeesTyped(piece.unit_cost)}
      save={async (typed) => {
        const answer = await itemsApi.changeConsumable(piece.code, { unit_cost: paiseFromRupees(typed) });
        if (!answer.ok) return errorText(errors, answer);
        await props.refresh();
        return null;
      }}
    >
      {(control, typed, type) => (
        <NumberInput
          {...control}
          width="amount"
          inputMode="decimal"
          value={typed}
          onChange={(event) => {
            type(event.target.value);
          }}
        />
      )}
    </EditableRow>
  );
}

const asked = (open: string, name: string, warning: string) => ({
  open,
  label: () => `${open} ${name}`,
  warning: () => warning,
  confirm: open,
  sending: open,
  cancel: packagesCopy.cancel,
});

/** Retiring one, selling it again, and deleting one never stocked. */
function HairSystemFoot(props: {
  readonly piece: PackageHairSystem;
  readonly today: string;
  readonly refresh: () => Promise<void>;
  readonly onGone: () => void;
}) {
  const { piece, refresh } = props;
  const access = useAccess();
  const [busy, once] = useOneAtATime();
  const [refused, setRefused] = useState<string | null>(null);
  const restore = () =>
    once(async () => {
      const answer = await itemsApi.restoreConsumable(piece.code);
      if (!answer.ok) {
        setRefused(errorText(errors, answer));
        return;
      }
      await refresh();
    });
  return (
    <div className={styles.foot}>
      {piece.offered && access.mayCall("POST /api/consumables/{code}/retire") && (
        <DeleteAction
          name={piece.name}
          tone="danger"
          words={asked(copy.retire, piece.name, copy.retireAsk)}
          send={() => itemsApi.retireConsumable(piece.code, props.today)}
          refusal={(code) => errorText(errors, { code })}
          onDeleted={refresh}
        />
      )}
      {!piece.offered && access.mayCall("POST /api/consumables/{code}/restore") && (
        <Button variant="outline" size="small" busy={busy} onClick={() => void restore()}>
          {copy.restore}
        </Button>
      )}
      {!piece.used && access.mayCall("POST /api/consumables/{code}/delete") && (
        <DeleteAction
          name={piece.name}
          words={asked(copy.delete, piece.name, copy.deleteAsk)}
          send={() => itemsApi.deleteConsumable(piece.code)}
          refusal={(code) => errorText(errors, { code })}
          onDeleted={async () => {
            await refresh();
            props.onGone();
          }}
        />
      )}
      {refused !== null && <Refusal said={refused} />}
    </div>
  );
}

/** One hair system's record: its price, its cost, and retiring, selling again or deleting it. */
function HairSystemRecord(props: {
  readonly piece: PackageHairSystem;
  readonly today: string;
  readonly refresh: () => Promise<void>;
  readonly onGone: () => void;
}) {
  const { piece, today, refresh } = props;
  return (
    <div className={styles.hairSystem} aria-label={piece.name} role="group">
      <PriceRow
        label={packagesCopy.rows.price}
        item="hair_system"
        tier={piece.code}
        prices={piece.prices}
        today={today}
        mayChange={useAccess().mayCall("POST /api/prices") && piece.offered}
        onSaved={refresh}
        unpriced={packagesCopy.unpriced}
      />
      <Cost piece={piece} refresh={refresh} />
      <HairSystemFoot piece={piece} today={today} refresh={refresh} onGone={props.onGone} />
    </div>
  );
}

/** The package's hair systems, a row each, its spec the way its record opens. */
function HairSystemTable(props: {
  readonly chosen: Package;
  readonly open: string | null;
  readonly onOpen: (code: string | null) => void;
}) {
  const { chosen, open } = props;
  if (chosen.hair_systems.length === 0) return <EmptyState look="panel" line={copy.none} />;
  return (
    <Table>
      <thead>
        <tr>
          {Object.values(copy.columns).map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {chosen.hair_systems.map((piece) => (
          <tr key={piece.code}>
            <RowHead>
              <TextButton
                compact
                aria-expanded={open === piece.code}
                aria-label={copy.open(specOf(piece))}
                onClick={() => {
                  props.onOpen(open === piece.code ? null : piece.code);
                }}
              >
                {specOf(piece)}
              </TextButton>
            </RowHead>
            <td>{piece.price === null ? packagesCopy.unpriced : priceText(piece.price)}</td>
            <td>{rupees(piece.unit_cost)}</td>
            <td>
              <Badge tone={piece.offered ? "done" : "neutral"}>{piece.offered ? copy.offered : copy.retired}</Badge>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function HairSystems(props: {
  readonly chosen: Package;
  readonly today: string;
  readonly refresh: () => Promise<void>;
}) {
  const { chosen, today, refresh } = props;
  const access = useAccess();
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const opened = chosen.hair_systems.find((piece) => piece.code === open);
  return (
    <>
      <HairSystemTable chosen={chosen} open={open} onOpen={setOpen} />
      {opened !== undefined && (
        <HairSystemRecord
          key={opened.code}
          piece={opened}
          today={today}
          refresh={refresh}
          onGone={() => {
            setOpen(null);
          }}
        />
      )}
      {access.mayCall("POST /api/hair-systems") &&
        (adding ? (
          <AddHairSystem
            product={chosen.code}
            onAdded={async () => {
              setAdding(false);
              await refresh();
            }}
            onCancel={() => {
              setAdding(false);
            }}
          />
        ) : (
          <div className={styles.addRow}>
            <Button
              variant="outline"
              size="small"
              onClick={() => {
                setAdding(true);
              }}
            >
              {copy.add}
            </Button>
          </div>
        ))}
    </>
  );
}
