// Operations · Usage (docs/decisions/0186-usage-and-shrinkage.md): over the last weeks, each technician's consumables
// against what their visits were expected to use, each opened to its items; and each place's losses, the flagged first.

import { Panel } from "@maneman/ui/Panel";
import { Button } from "@maneman/ui/Button";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { rupees } from "@maneman/web-kit/money";
import { useState } from "react";
import { client } from "../api.ts";
import type { paths } from "../api-schema.ts";
import form from "../components/forms.module.css";
import { usage as copy } from "../content/usage.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { RowHead } from "../components/RowHead.tsx";

type Usage = paths["/api/stock/usage"]["get"]["responses"][200]["content"]["application/json"];
type Technician = Usage["technicians"][number];

const loadUsage = () => client.get("/api/stock/usage");

const quantity = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 1 });

function Head({ columns }: { columns: readonly string[] }) {
  return (
    <thead>
      <tr>
        {columns.map((column, index) => (
          <th key={column} scope="col" className={index === 0 ? undefined : form.figure}>
            {column}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function Items({ technician }: { technician: Technician }) {
  return (
    <Table className={form.table}>
      <Head columns={copy.itemColumns} />
      <tbody>
        {technician.items.map((item) => (
          <tr key={item.consumable_code}>
            <RowHead>{item.name}</RowHead>
            <td className={form.figure}>{quantity(item.expected)}</td>
            <td className={form.figure}>{quantity(item.used)}</td>
            <td className={form.figure}>{copy.over(item.over_percent)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function Technicians({ usage }: { usage: Usage }) {
  const [open, setOpen] = useState<string | null>(null);
  const opened = usage.technicians.find((technician) => technician.technician_id === open);
  return (
    <Panel titleId="usage-technicians" title={copy.technicians}>
      <p className={form.note}>{copy.techniciansNote}</p>
      {usage.technicians.length === 0 ? (
        <p className={form.note}>{copy.noTechnicians}</p>
      ) : (
        <Table className={form.table}>
          <Head columns={copy.technicianColumns} />
          <tbody>
            {usage.technicians.map((technician) => (
              <tr key={technician.technician_id}>
                <RowHead>
                  {technician.name}
                  {technician.flagged && <p className={form.note}>{copy.flagged}</p>}
                </RowHead>
                <td className={form.figure}>{technician.visits}</td>
                <td className={form.figure}>{rupees(technician.expected_value)}</td>
                <td className={form.figure}>{rupees(technician.used_value)}</td>
                <td className={form.figure}>{copy.over(technician.over_percent)}</td>
                <td>
                  <Button
                    variant="outline"
                    size="small"
                    aria-label={copy.items(technician.name)}
                    onClick={() => {
                      setOpen(technician.technician_id);
                    }}
                  >
                    {copy.itemsShort}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {opened !== undefined && (
        <div className={form.group}>
          <h3 className={form.ruleTitle}>{copy.items(opened.name)}</h3>
          <Items technician={opened} />
        </div>
      )}
    </Panel>
  );
}

function Places({ usage }: { usage: Usage }) {
  return (
    <Panel titleId="usage-places" title={copy.places}>
      <p className={form.note}>{copy.placesNote}</p>
      {usage.places.length === 0 ? (
        <p className={form.note}>{copy.noPlaces}</p>
      ) : (
        <Table className={form.table}>
          <Head columns={copy.placeColumns} />
          <tbody>
            {usage.places.map((place) => (
              <tr key={place.place_id}>
                <RowHead>
                  {place.place}
                  {place.flagged && <p className={form.note}>{copy.flagged}</p>}
                </RowHead>
                <td className={form.figure}>{rupees(place.left_value)}</td>
                <td className={form.figure}>{rupees(place.lost_value)}</td>
                <td className={form.figure}>{copy.percent(place.shrinkage_percent)}</td>
                <td className={form.figure}>{place.write_offs}</td>
                <td className={form.figure}>{copy.percent(place.count_accuracy_percent)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}

export function UsageScreen() {
  const [loaded, retry] = useLoad(loadUsage);
  return (
    <>
      {loaded.state === "loading" && <Loading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {loaded.state === "loaded" && (
        <div className={form.screen}>
          <p className={form.note}>{copy.since(loaded.value.since)}</p>
          <Technicians usage={loaded.value} />
          <Places usage={loaded.value} />
        </div>
      )}
    </>
  );
}
