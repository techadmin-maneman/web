// Finance · Prices · Hair system costs (docs/decisions/0152-standard-costs.md): what each first fit and replacement
// product costs us, for the margin figures, until stock lots carry what was paid. A figure set counts from today.

import { Button } from "@maneman/ui/Button";
import { TextInput } from "@maneman/ui/Field";
import { Panel } from "@maneman/ui/Panel";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import type { Sent as Body, Success } from "@maneman/web-kit/api";
import { shortDate } from "@maneman/web-kit/dates";
import { paiseFromRupees, rupeeFigure, rupeesTyped } from "@maneman/web-kit/money";
import { useState } from "react";
import type { paths } from "../api-schema.ts";
import { settings } from "../content/settings.ts";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { CheckPanel } from "../components/CheckPanel.tsx";
import { review } from "../content/common.ts";
import { Refused, sentOf, useSteps } from "../settings/index.ts";
import form from "../components/forms.module.css";
import { pricesApi } from "./prices-api.ts";

type Product = Success<paths["/api/standard-costs"]["get"]>["products"][number];
type CostChange = Body<paths["/api/standard-costs"]["post"]>;

const copy = settings.standardCosts;

const loadCosts = () => pricesApi.standardCosts();

function CostRow(props: { product: Product; mayChange: boolean; onSaved: (products: Product[]) => void }) {
  const { product } = props;
  const [typed, setTyped] = useState(product.cost === null ? "" : rupeesTyped(product.cost));
  const label = `${copy.kinds[product.item]} · ${product.name}`;
  const standing = product.cost === null ? copy.notSet : rupeeFigure(product.cost);
  const steps = useSteps(
    async () => {
      const change: CostChange = { item: product.item, tier: product.tier, cost: paiseFromRupees(typed) };
      return sentOf(await pricesApi.setStandardCost(change), (body) => ({
        products: body.products,
      }));
    },
    (sent) => {
      steps.edit();
      props.onSaved(sent.products);
    },
  );
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
              steps.edit();
            }}
          />
        ) : (
          standing
        )}
      </td>
      <td>{product.since === null ? copy.notSet : shortDate(product.since)}</td>
      {props.mayChange && (
        <td>
          {steps.step === "editing" ? (
            <Button
              variant="outline"
              size="small"
              aria-label={copy.reviewLabel(label)}
              disabled={!/^\d+$/.test(typed.trim())}
              onClick={steps.check}
            >
              {review.next}
            </Button>
          ) : (
            <CheckPanel
              lines={[copy.change(label, standing, rupeeFigure(paiseFromRupees(typed)))]}
              busy={steps.step === "saving"}
              onSend={steps.go}
              onBack={steps.edit}
            />
          )}
          <Refused failed={steps.failed} errors={copy.errors} />
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
    <Panel titleId="standard-costs" title={copy.title} className={form.panel}>
      <p className={form.note}>{copy.note}</p>
      <Table className={form.table}>
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
