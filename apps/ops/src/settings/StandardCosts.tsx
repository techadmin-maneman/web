// Finance · Prices · Hair system costs (docs/decisions/0152-standard-costs.md): what each first fit and replacement
// product costs us, for the margin figures, until stock lots carry what was paid. A figure set counts from today.

import { Button } from "@maneman/ui/Button";
import { TextInput } from "@maneman/ui/Field";
import { Panel } from "@maneman/ui/Panel";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import type { Sent, Success } from "@maneman/web-kit/api";
import { shortDate } from "@maneman/web-kit/dates";
import { paiseFromRupees, rupeeFigure } from "@maneman/web-kit/money";
import type { Failure } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { client } from "../api.ts";
import type { paths } from "../api-schema.ts";
import { settings } from "../content/settings.ts";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { Refused } from "./SettingForm.tsx";
import styles from "../components/forms.module.css";

type Product = Success<paths["/api/standard-costs"]["get"]>["products"][number];
type CostChange = Sent<paths["/api/standard-costs"]["post"]>;

const copy = settings.standardCosts;

const loadCosts = () => client.get("/api/standard-costs");

function CostRow(props: { product: Product; mayChange: boolean; onSaved: (products: Product[]) => void }) {
  const { product } = props;
  const [typed, setTyped] = useState(product.cost === null ? "" : String(product.cost / 100));
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const label = `${copy.kinds[product.item]} · ${product.name}`;
  const standing = product.cost === null ? copy.notSet : rupeeFigure(product.cost);
  const save = async () => {
    setBusy(true);
    setFailure(null);
    const change: CostChange = { item: product.item, tier: product.tier, cost: paiseFromRupees(typed) };
    const answer = await client.post("/api/standard-costs", { body: change });
    setBusy(false);
    if (answer.ok) props.onSaved(answer.body.products);
    else setFailure({ code: answer.code, fields: answer.fields });
  };
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>
        {props.mayChange ? (
          <TextInput
            aria-label={copy.costLabel(label)}
            inputMode="numeric"
            maxLength={9}
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
            }}
          />
        ) : (
          standing
        )}
        <Refused failed={failure} errors={copy.errors} />
      </td>
      <td>{product.since === null ? copy.notSet : shortDate(product.since)}</td>
      {props.mayChange && (
        <td>
          <Button
            variant="outline"
            size="small"
            disabled={busy || !/^\d+$/.test(typed.trim())}
            onClick={() => void save()}
          >
            {copy.save}
          </Button>
        </td>
      )}
    </tr>
  );
}

export function StandardCosts() {
  const [loaded, retry] = useLoad(loadCosts);
  const [products, setProducts] = useState<Product[] | null>(null);
  const mayChange = useAccess().mayCall("POST /api/standard-costs");
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const shown = products ?? loaded.value.products;
  return (
    <Panel titleId="standard-costs" title={copy.title} className={styles.panel}>
      <p className={styles.note}>{copy.note}</p>
      <Table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{copy.columns.product}</th>
            <th scope="col">{copy.columns.cost}</th>
            <th scope="col">{copy.columns.since}</th>
            {mayChange && <th scope="col" />}
          </tr>
        </thead>
        <tbody>
          {shown.map((product) => (
            <CostRow
              key={`${product.item}/${product.tier}/${String(product.cost)}`}
              product={product}
              mayChange={mayChange}
              onSaved={setProducts}
            />
          ))}
        </tbody>
      </Table>
    </Panel>
  );
}
