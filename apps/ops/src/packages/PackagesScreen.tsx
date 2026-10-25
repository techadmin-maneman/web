// Settings · Packages (docs/decisions/0211-packages.md): every package as a row, each part's price a column of its own,
// what a first fit comes to and what it leaves us; a row opens its record beneath the list, where each value changes in
// place (docs/decisions/0212-editing-in-place.md). Every write answers every package as it stands, so the page follows.

import { Button } from "@maneman/ui/Button";
import { EmptyState } from "@maneman/ui/EmptyState";
import { Label, TextInput } from "@maneman/ui/Field";
import { Panel } from "@maneman/ui/Panel";
import { Table, TableScroll } from "@maneman/ui/Table";
import { TextButton } from "@maneman/ui/TextLink";
import { useLoad } from "@maneman/ui/useLoad";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useRowPanel, type RowOpener } from "@maneman/ui/useRowPanel";
import { shortDate } from "@maneman/web-kit/dates";
import { errorText } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { Badge } from "@maneman/ui/Badge";
import { RowHead } from "../components/RowHead.tsx";
import { Refusal } from "../components/Refusal.tsx";
import { priceText } from "../components/PriceRow.tsx";
import { packagesCopy as copy } from "../content/packages.ts";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import form from "../components/forms.module.css";
import { PackageRecord } from "./PackageRecord.tsx";
import { packagesApi, type Package, type Packages, type ProductCost } from "./packages-api.ts";
import { pricesApi } from "../prices/index.ts";
import { rupees } from "@maneman/web-kit/money";
import { cheapestHairSystem, firstFitCost, firstFitMargin } from "./package-figures.ts";
import styles from "./packages.module.css";

const loadPackages = () => packagesApi.packages();
const loadCosts = () => pricesApi.standardCosts();

/** Where a package stands today: on sale, not yet priced, retiring from a day, or retired. */
function statusOf(each: Package, today: string) {
  if (each.retired_date !== null && each.retired_date <= today)
    return <Badge tone="neutral">{copy.status.retired}</Badge>;
  if (each.retired_date !== null) {
    return <Badge tone="warning">{copy.status.retiring(shortDate(each.retired_date))}</Badge>;
  }
  return each.offered ? (
    <Badge tone="done">{copy.status.sold}</Badge>
  ) : (
    <Badge tone="attention">{copy.status.unpriced}</Badge>
  );
}

/** A price in its column, or a gap where it has none yet. */
const priceOrGap = (price: Parameters<typeof priceText>[0] | null | undefined) =>
  price === null || price === undefined ? copy.gap : priceText(price);

/** One package's figures, a column each. */
function PackageFigures({ each, costs }: { readonly each: Package; readonly costs: readonly ProductCost[] }) {
  const cost = firstFitCost(each, costs);
  const margin = firstFitMargin(each, cost);
  return (
    <>
      <td className={form.figure}>{priceOrGap(cheapestHairSystem(each)?.price)}</td>
      <td className={form.figure}>{priceOrGap(each.service.price)}</td>
      <td className={form.figure}>{copy.days(each.service.every_days)}</td>
      <td className={form.figure}>{priceOrGap(each.first_fit.from)}</td>
      <td className={form.figure}>{priceOrGap(each.replacement.price)}</td>
      <td className={form.figure}>{copy.months(each.replacement.after_months)}</td>
      <td className={form.figure}>{cost === null ? copy.gap : rupees(cost)}</td>
      <td className={form.figure}>{margin === null ? copy.gap : rupees(margin)}</td>
    </>
  );
}

function PackageList(props: {
  readonly packages: Packages;
  readonly costs: readonly ProductCost[];
  readonly opener: RowOpener;
}) {
  const { packages, today } = props.packages;
  if (packages.length === 0) return <EmptyState look="panel" line={copy.none} />;
  return (
    <TableScroll labelledBy="packages-title">
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
          {packages.map((each) => (
            <tr key={each.code}>
              <RowHead>
                <TextButton compact aria-label={copy.open(each.name)} {...props.opener(each.code)}>
                  {each.name}
                </TextButton>
              </RowHead>
              <PackageFigures each={each} costs={props.costs} />
              <td>{statusOf(each, today)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </TableScroll>
  );
}

/** A new package's name, added last; its record opens once it is. */
function AddPackage(props: {
  readonly onAdded: (body: Packages, code: string) => void;
  readonly onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [refused, setRefused] = useState<string | null>(null);
  const [busy, once] = useOneAtATime();
  const add = () =>
    once(async () => {
      const answer = await packagesApi.add(name.trim());
      if (!answer.ok) {
        setRefused(errorText(copy.errors, answer));
        return;
      }
      const added = answer.body.packages.find((each) => each.name === name.trim());
      props.onAdded(answer.body, added?.code ?? "");
    });
  return (
    <form
      noValidate
      className={styles.add}
      onSubmit={(event) => {
        event.preventDefault();
        void add();
      }}
    >
      <Label htmlFor="new-package" className={styles.addLabel}>
        {copy.name}
      </Label>
      <TextInput
        id="new-package"
        width="area"
        maxLength={46}
        value={name}
        autoFocus
        onChange={(event) => {
          setName(event.target.value);
        }}
      />
      <Button variant="primary" size="small" type="submit" busy={busy}>
        {copy.create}
      </Button>
      <Button variant="quiet" size="small" narrow onClick={props.onCancel}>
        {copy.cancel}
      </Button>
      {refused !== null && <Refusal className={styles.addRefusal} said={refused} />}
    </form>
  );
}

export function PackagesScreen() {
  const [loaded, retry] = useLoad(loadPackages);
  const [shown, setShown] = useState<Packages | null>(null);
  const [adding, setAdding] = useState(false);
  const { open, setOpen, panelId, opener } = useRowPanel();
  const access = useAccess();
  const mayAdd = access.mayCall("POST /api/packages");
  const current = shown ?? (loaded.state === "loaded" ? loaded.value : null);
  const [costsLoaded] = useLoad(loadCosts);
  const [costs, setCosts] = useState<readonly ProductCost[] | null>(null);
  const costsShown = costs ?? (costsLoaded.state === "loaded" ? costsLoaded.value.products : []);
  const refresh = async () => {
    const answer = await loadPackages();
    if (answer.ok) setShown(answer.body);
  };

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  if (current === null) return null;
  const opened = current.packages.find((each) => each.code === open);
  return (
    <div className={form.screen}>
      <Panel
        titleId="packages-title"
        title={copy.title}
        count={current.packages.length}
        actions={
          mayAdd && !adding ? (
            <Button
              variant="outline"
              size="small"
              onClick={() => {
                setAdding(true);
              }}
            >
              {copy.add}
            </Button>
          ) : undefined
        }
      >
        {adding && (
          <AddPackage
            onAdded={(body, code) => {
              setShown(body);
              setAdding(false);
              setOpen(code);
            }}
            onCancel={() => {
              setAdding(false);
            }}
          />
        )}
        <PackageList packages={current} costs={costsShown} opener={opener} />
      </Panel>
      {opened !== undefined && (
        <PackageRecord
          key={opened.code}
          panelId={panelId}
          packages={current}
          chosen={opened}
          onChanged={setShown}
          refresh={refresh}
          onGone={() => {
            setOpen(null);
          }}
          costs={costsShown}
          onCosts={setCosts}
        />
      )}
    </div>
  );
}
