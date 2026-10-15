// Settings › Prices › Hair systems (docs/decisions/0152-standard-costs.md): what each first fit and replacement product
// costs us, for the margin figures, until stock lots carry what was paid; a row each. A figure set counts from today.

import { Button } from "@maneman/ui/Button";
import { TextInput } from "@maneman/ui/Field";
import { Panel } from "@maneman/ui/Panel";
import { SettingRow, SettingValue } from "@maneman/ui/SettingRow";
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
import { pricesApi } from "./prices-api.ts";
import styles from "./prices.module.css";

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
  const since = product.since === null ? null : copy.since(shortDate(product.since));
  if (!props.mayChange)
    return <SettingValue label={label} value={since === null ? standing : `${standing} · ${since}`} />;
  return (
    <>
      <SettingRow label={label} unit={copy.unit}>
        {(control) => (
          <>
            <TextInput
              {...control}
              width="amount"
              inputMode="numeric"
              maxLength={9}
              value={typed}
              disabled={steps.step !== "editing"}
              onChange={(event) => {
                setTyped(event.target.value);
                steps.edit();
              }}
            />
            {steps.step === "editing" && typed.trim() !== (product.cost === null ? "" : rupeesTyped(product.cost)) && (
              <Button
                variant="outline"
                size="small"
                aria-label={copy.reviewLabel(label)}
                disabled={!/^\d+$/.test(typed.trim())}
                onClick={steps.check}
              >
                {review.next}
              </Button>
            )}
          </>
        )}
      </SettingRow>
      {steps.step !== "editing" && (
        <div className={styles.check}>
          <CheckPanel
            lines={[copy.change(label, standing, rupeeFigure(paiseFromRupees(typed)))]}
            busy={steps.step === "saving"}
            onSend={steps.go}
            onBack={steps.edit}
          />
        </div>
      )}
      <Refused failed={steps.failed} errors={copy.errors} />
    </>
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
    <Panel titleId="standard-costs" title={copy.title}>
      {shown.map((product) => (
        <CostRow
          key={`${product.item}/${product.tier}/${String(product.cost)}`}
          product={product}
          mayChange={mayChange}
          onSaved={setProducts}
        />
      ))}
    </Panel>
  );
}
